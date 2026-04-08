# Fzfetch 前端目录规划

这份文档只定义前端工程路径与职责边界，方便你交给另一个 agent 开工。当前后端实现已经稳定，前端只需要围绕 WebSocket 搜索、结果渲染和下载交互展开，不承担任何模糊匹配与本地文件扫描逻辑。

## 1. 推荐目录结构

```text
frontend/
├── package.json
├── index.html
├── public/
│   └── favicon.svg
└── src/
    ├── main.ts
    ├── app/
    │   ├── bootstrap.ts
    │   ├── app-shell.ts
    │   └── routes.ts
    ├── features/
    │   └── search/
    │       ├── components/
    │       │   ├── search-input.ts
    │       │   ├── result-list.ts
    │       │   ├── result-item.ts
    │       │   ├── empty-state.ts
    │       │   └── status-badge.ts
    │       ├── model/
    │       │   ├── search-store.ts
    │       │   ├── search-types.ts
    │       │   └── req-epoch.ts
    │       ├── services/
    │       │   ├── ws-client.ts
    │       │   ├── download-client.ts
    │       │   └── debounce.ts
    │       ├── views/
    │       │   └── search-page.ts
    │       └── index.ts
    ├── shared/
    │   ├── dom/
    │   │   ├── mount.ts
    │   │   └── render.ts
    │   ├── utils/
    │   │   ├── json.ts
    │   │   ├── time.ts
    │   │   └── path.ts
    │   └── types/
    │       └── api.ts
    └── styles/
        ├── tokens.css
        ├── base.css
        └── search.css
```

## 2. 各目录职责

### `src/app/`

- 只放应用启动与装配逻辑。
- `bootstrap.ts` 负责初始化根节点、注入全局事件。
- `app-shell.ts` 负责页面整体骨架，不放业务状态。

### `src/features/search/`

- 搜索是唯一核心功能，建议独立成 feature。
- `components/` 只做视图渲染，不写网络细节。
- `model/search-store.ts` 维护当前 query、最新 `req_id`、连接状态、结果列表。
- `model/req-epoch.ts` 只做前端请求纪元管理，用来和后端 `req_id` 对齐。
- `services/ws-client.ts` 负责：
  - 建立 `/ws` 连接。
  - 发送 `{"req_id","query"}`。
  - 接收搜索结果与 `INDEX_REFRESHED` 广播。
- `services/download-client.ts` 负责构造 `/download?path=` 请求。
- `services/debounce.ts` 只做轻量防抖，前端不要做重计算。

### `src/shared/`

- 放跨功能复用的小工具。
- 不要把业务状态混进 `shared`。
- `types/api.ts` 建议统一声明后端协议类型，例如：
  - `SearchRequest`
  - `SearchResponse`
  - `SearchResultItem`
  - `IndexRefreshedEvent`

### `src/styles/`

- `tokens.css` 定义颜色、间距、字体变量。
- `base.css` 做重置和全局基础样式。
- `search.css` 只承载搜索页特有样式。

## 3. 与后端的接口边界

前端 agent 只需要对接下面两个接口：

### WebSocket `/ws`

发送：

```json
{"req_id":123,"query":"rust"}
```

接收搜索结果：

```json
{
  "req_id": 123,
  "data": [
    {"path":"/abs/path/a.rs","score":99}
  ]
}
```

接收刷新广播：

```json
{"type":"INDEX_REFRESHED"}
```

前端必须遵守：

- 输入事件做微防抖，不要发送每个按键的原始洪峰。
- 维护本地最新 `req_id`，收到旧响应时直接忽略。
- 收到 `INDEX_REFRESHED` 时不必自动清空输入，可以按当前 query 重新发一次查询。

### HTTP `/download`

请求格式：

```text
GET /download?path=/abs/path/to/file
```

前端必须遵守：

- 只把后端搜索返回的绝对路径传给下载接口。
- 若收到 `410 Gone`，静默把该条目从当前结果中移除。
- 不要在前端自行做文件存在性校验，保持惰性校验策略。

## 4. 建议给前端 agent 的工作顺序

1. 先完成 `shared/types/api.ts`，把后端协议固定下来。
2. 再实现 `services/ws-client.ts` 和 `model/search-store.ts`。
3. 然后实现 `search-input.ts`、`result-list.ts`、`result-item.ts`。
4. 最后做页面骨架、样式和交互打磨。

## 5. 不要做的事

- 不要把模糊匹配逻辑搬到前端。
- 不要把全量索引数据缓存到浏览器。
- 不要在前端轮询文件系统状态。
- 不要为了“更实时”而绕开 `req_id` 纪元判断。
