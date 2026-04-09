# Fzfetch 后端说明

## 1. 目标与边界

Fzfetch 后端负责所有重计算和索引驻留，前端只负责事件采集与渲染。当前实现严格遵循以下原则：

- 首次真正有用户请求时才将 `data/cache.txt` 载入内存。
- `cache.txt` 不存在时，进程启动阶段自动创建 `data/` 与空的 `data/cache.txt`，便于 Docker 持久化挂载。
- 内存索引超过 `refresh_ttl` 未刷新时，在用户搜索触发时后台异步刷新。
- 内存索引超过 `idle_ttl` 未被使用时，后台清理任务会将索引从内存移除。
- WebSocket 搜索采用“前端微防抖 + 后端 req_id 纪元拦截”模型，过期结果直接丢弃。
- 下载接口执行惰性校验，幽灵文件返回 `410 Gone`。

## 2. 目录与模块

- `src/main.rs`
  - 读取运行时配置。
  - 启动时确保 `data/cache.txt` 存在。
  - 注册 WebSocket 搜索接口与下载接口。
  - 启动空闲索引清理循环。
- `src/config.rs`
  - `AppConfig` 统一管理根目录、`data/cache.txt`、TTL、清理周期、TopK。
  - 支持从环境变量读取刷新 TTL、空闲 TTL、清理周期与 TopK。
- `src/cache.rs`
  - 负责 `data/` 与 `cache.txt` 的创建。
  - 负责缓存文件读写与原子替换。
- `src/scanner.rs`
  - 全盘扫描根目录，只收集常规文件。
  - 使用 `HashSet` 做新增/删除差异比对。
- `src/search.rs`
  - 对 `nucleo` 进行薄封装。
  - 新增路径时走 injector 增量注入。
  - 若存在删除路径，则 `restart(true)` 后整体重灌，保证删除生效。
- `src/state.rs`
  - 管理懒加载索引、后台刷新、空闲卸载与刷新广播。
  - 只常驻 `nucleo` 搜索索引，不再额外常驻一份完整路径 `HashSet<String>`。
- `src/ws.rs`
  - 处理 WebSocket 搜索。
  - 使用 `AtomicU64` 做同连接最新请求纪元拦截。
- `src/api.rs`
  - 处理安全下载、沙箱校验与 `410 Gone`。

## 3. 运行时配置

当前支持以下环境变量：

- `FZFETCH_ROOT`
  - 需要建立索引的根目录。
  - 默认值：当前工作目录下的 `files`。
- `FZFETCH_DATA_DIR`
  - 应用状态目录，当前用于放置缓存文件。
  - 默认值：当前工作目录下的 `data`。
- `FZFETCH_REFRESH_TTL_SECS`
  - 缓存过期秒数，过期后用户下一次搜索会触发后台刷新。
  - 默认值：`86400`。
- `FZFETCH_IDLE_TTL_SECS`
  - 索引空闲秒数，超过后会被清出内存。
  - 默认值：`1800`。
- `FZFETCH_CLEANUP_INTERVAL_SECS`
  - 空闲清理循环的检查周期。
  - 默认值：`60`。
- `FZFETCH_TOP_K`
  - 单次搜索返回上限。
  - 默认值：`100`。

说明：

- `cache.txt` 路径固定为 `FZFETCH_DATA_DIR/cache.txt`，默认即 `data/cache.txt`。
- 启动时若 `FZFETCH_ROOT` 或 `FZFETCH_DATA_DIR` 不存在，进程会自动创建目录。
- 若服务启动时发现 `cache.txt` 是新创建的空文件，则首次用户搜索会立即触发一次后台刷新，不会等到 24 小时后。

## 4. 索引生命周期

### 4.1 启动阶段

1. `main` 调用 `ensure_cache_layout`。
2. 若 `data/cache.txt` 不存在，则创建空文件，并记录“需要首次刷新”标记。
3. Web 服务立即启动，不阻塞于全盘扫描。

### 4.2 首次使用

1. 用户第一次发起搜索。
2. `IndexManager::ensure_loaded()` 读取 `data/cache.txt`。
3. 所有路径注入 `nucleo` 内存索引。
4. 若缓存是启动时新建的空缓存，或者缓存 mtime 已超过 `refresh_ttl`，则异步触发后台刷新。

### 4.3 后台刷新

1. `scan_root_files()` 遍历根目录收集所有文件绝对路径。
2. `diff_paths()` 使用 `HashSet` 计算 `added` 与 `removed`。
3. 将新快照覆盖写回 `data/cache.txt`。
4. 更新内存索引：
   - 后台刷新阶段临时读取 `cache.txt` 旧快照，和新扫描结果做 `HashSet` 差异比较。
   - 若只有新增，则走 injector 增量注入。
   - 若存在删除，则重建 `nucleo` 池并整体重灌。
   - 差异计算所需的 `HashSet` 只在刷新阶段短暂存在，不作为运行时常驻状态保留。
5. 向所有在线 WebSocket 客户端广播：

```json
{"type":"INDEX_REFRESHED"}
```

### 4.4 空闲卸载

后台任务每隔 `cleanup_interval` 检查一次内存索引：

- 若距离最近一次使用超过 `idle_ttl`，且当前没有刷新任务正在执行，则将索引整体释放。
- 下一次真正有搜索请求时再从 `data/cache.txt` 重新载入。

## 5. WebSocket 搜索协议

客户端请求：

```json
{"req_id":123,"query":"rust"}
```

服务端响应：

```json
{
  "req_id": 123,
  "data": [
    {"path":"/abs/path/a.rs","score":99}
  ]
}
```

同连接内的洪峰控制逻辑：

1. 收到请求后，先把 `req_id` 写入当前连接独享的 `AtomicU64`。
2. 后台完成模糊搜索后，再读一次该原子值。
3. 若原子值已经不是当前请求的 `req_id`，说明该结果已过期，直接丢弃，不向前端发送。

这保证了快输入场景下，后端不会把旧查询结果继续挤占网络和前端渲染队列。

## 6. 下载接口

接口：

```text
GET /download?path=/abs/path/to/file.pdf
```

处理顺序：

1. 要求 `path` 必须是绝对路径，否则返回 `400`。
2. 对可解析的现存祖先路径做 `canonicalize`，判断是否仍在允许的根目录内，越界则返回 `403`。
3. 若物理文件已不存在，则返回 `410 Gone`，这就是惰性校验策略的落点。
4. 若存在但不是常规文件，则返回 `404`。
5. 合法文件以流式方式返回，避免整文件读入内存。

这样可以兼顾：

- 防止 `../../` 路径穿越。
- 正确识别“越权路径但文件不存在”的场景，优先返回 `403` 而不是 `410`。
- 对索引中的幽灵文件执行最终兜底清理。
