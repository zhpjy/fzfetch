# Fzfetch 后端日志设计

## 1. 目标

为 Fzfetch Rust 后端补齐结构化运行日志，使以下行为在默认 `info` 级别下可观测：

- 服务启动与配置装载
- `data/cache.txt` 创建与启动阶段准备
- 懒加载索引开始/完成
- 首次空缓存触发刷新、TTL 触发刷新、后台刷新完成
- WebSocket 连接建立与关闭
- 下载请求开始、成功、`410 Gone`、`403 Forbidden`、`404 Not Found`
- 空闲索引卸载

同时保留 `debug` 级别下的细粒度排查能力：

- 每条搜索请求与原始 `query`
- `req_id` 过期结果丢弃
- 刷新跳过原因
- 下载路径 canonicalize / 沙箱判定细节
- 刷新 diff 统计与广播细节

## 2. 日志分层

### 2.1 `info`

默认级别，用于日常运行与联调。

要求：

- 不记录原始搜索词 `query`
- 不记录下载完整路径 `path`
- 优先记录业务阶段、计数、状态和配置概览

### 2.2 `debug`

用于故障排查与联调深挖。

要求：

- 允许记录原始 `query`
- 允许记录下载完整路径
- 记录细粒度行为与跳过原因

### 2.3 `warn` / `error`

- `warn`：请求异常、协议错误、非致命运行异常
- `error`：后台刷新失败、序列化失败、内部异常等

## 3. 隐私与字段规则

### 3.1 搜索

- `info` 不记录原始 `query`
- `debug` 记录原始 `query`
- 两个级别都可以记录 `query_len`

### 3.2 下载

- `info` 不记录完整路径
- `info` 仅记录 `path_hint`
  - 优先记录文件名
  - 若无法提取文件名，则记录 `<unknown>`
- `debug` 记录完整路径、canonicalize 后路径与沙箱判定路径

## 4. 模块设计

### 4.1 `main.rs`

新增 `info` 日志：

- 配置加载完成
  - `root_dir`
  - `cache_file`
  - `refresh_ttl_secs`
  - `idle_ttl_secs`
  - `cleanup_interval_secs`
  - `top_k`
- cache 布局准备完成
  - 是否新建 cache 文件
- cleanup loop 启动
- 服务监听地址

### 4.2 `state.rs`

新增 `info` 日志：

- 索引懒加载开始
- 索引懒加载完成
  - `path_count`
  - `cache_file`
- 首次空缓存触发刷新
- TTL 触发刷新
- 后台扫描开始
  - `root_dir`
- 后台扫描完成
  - `new_path_count`
  - `added`
  - `removed`
- cache 写回完成
- `INDEX_REFRESHED` 广播完成
- 空闲索引卸载

新增 `debug` 日志：

- 刷新跳过原因
  - cache 仍然新鲜
  - 已有刷新任务在运行
- cleanup 检查不卸载原因
  - 仍在 idle_ttl 内
  - 当前正在刷新

新增 `error` 日志：

- 后台刷新失败

### 4.3 `ws.rs`

新增 `info` 日志：

- WebSocket 连接建立
- WebSocket 连接关闭

新增 `debug` 日志：

- 收到搜索请求
  - `req_id`
  - `query`
  - `query_len`
- 搜索完成准备返回
  - `req_id`
  - `result_count`
- 旧 `req_id` 结果被丢弃
  - `req_id`
  - `latest_req_id`
- 刷新广播消息下发
- ping/pong 行为

新增 `warn/error` 日志：

- 非法 WebSocket 消息
- socket 接收失败
- writer task 失败
- 序列化失败

### 4.4 `api.rs`

新增 `info` 日志：

- 下载请求开始
  - `path_hint`
- 下载成功
  - `path_hint`
  - `content_length`
- 下载返回 `410`
  - `path_hint`
- 下载返回 `403`
  - `path_hint`
- 下载返回 `404`
  - `path_hint`

新增 `debug` 日志：

- 原始请求路径
- 现存祖先解析路径
- canonicalize 后路径
- 沙箱判定结果

## 5. 结构化字段

统一使用结构化字段，不只输出自由文本。

建议字段：

- `req_id`
- `query_len`
- `query`
- `result_count`
- `path_hint`
- `requested_path`
- `canonical_path`
- `sandbox_path`
- `root_dir`
- `cache_file`
- `path_count`
- `added`
- `removed`
- `refresh_ttl_secs`
- `idle_ttl_secs`
- `cleanup_interval_secs`
- `top_k`

## 6. 非目标

本轮不做：

- 独立日志模块抽象
- 日志 JSON 格式强制化
- tracing span 大规模重构
- 指标系统（metrics）
- ELK / Loki / OpenTelemetry 接入

## 7. 实施边界

本次实现只改后端运行日志，不改前端逻辑。

完成标准：

- `RUST_LOG=info cargo run` 下能看到关键行为主链路
- `RUST_LOG=debug cargo run` 下能看到搜索词、完整下载路径和细粒度决策
- 不改变既有业务行为
- 测试继续通过
