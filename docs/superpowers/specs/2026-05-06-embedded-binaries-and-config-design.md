# fzfetch 内嵌前端与跨平台二进制发布设计

## 目标

优化 GitHub Actions，让项目在发布时生成可直接运行的跨平台 `fzfetch` 单文件二进制。

同时新增配置文件支持，降低本地使用和二进制分发后的配置成本。

## 已检查的现状

- 当前分支 `github-actions-cross-platform-build` 与 `main` 指向同一提交。
- 已同步远端分支，远端只有 `origin/main` 和 `origin/feat/results-list-overflow-ui`。
- 所有本地和远端分支的 `.github/workflows/docker-image.yml` 内容完全一致。
- 现有 workflow 只负责构建并推送 GHCR Docker 镜像。
- 未发现已有分支实现过跨平台 binary、artifact 上传、release binary 或 target matrix 构建。

## 范围

本次改动包含：

- 将前端构建产物 `frontend/dist` 嵌入 Rust binary。
- 修改后端静态资源服务逻辑，使 binary 不依赖磁盘上的 `frontend/dist`。
- 新增 GitHub Actions workflow，构建并上传多个平台的单文件 binary。
- 新增 `fzfetch.toml` 配置文件支持。
- 新增仓库配置样例 `fzfetch.example.toml`。
- 更新中英文 README 和后端文档中的配置说明。

本次改动不包含：

- 改变搜索、扫描、缓存或下载接口行为。
- 移除已有 Docker 镜像发布 workflow。
- 自动创建 GitHub Release 或生成 release notes。
- 引入命令行参数解析框架。

## 前端内嵌方案

现状中，`src/main.rs` 固定调用 `build_app(state, PathBuf::from("frontend/dist"))`，`src/web.rs` 使用 `tower_http::services::ServeDir` 从磁盘服务静态文件。

新方案中，生产 binary 会内嵌 `frontend/dist`：

1. CI 和本地发布构建先运行 `npm --prefix frontend ci`。
2. 再运行 `npm --prefix frontend run build` 生成 `frontend/dist`。
3. Rust 编译通过构建期资源嵌入库读取 `frontend/dist`。
4. HTTP fallback 优先返回内嵌静态资源。
5. SPA 路由 fallback 返回内嵌的 `index.html`。

推荐使用 `rust-embed` 或同类成熟库完成资源嵌入，而不是手写目录遍历与 `include_bytes!` 清单。这样可以保持实现小、类型清晰，并减少遗漏 MIME 类型和路径规范化边界的风险。

## 静态资源服务行为

内嵌资源服务需要保持现有外部行为：

- `/ws` 继续走 WebSocket 路由。
- `/download` 继续走下载 API。
- 静态资源请求命中内嵌文件时，返回文件内容。
- 未命中的普通路径返回 `index.html`，保持前端 SPA 刷新可用。
- 静态资源响应设置合理的 `Content-Type`。

测试应覆盖：

- 能返回内嵌 `index.html`。
- 能返回内嵌静态资源。
- 未命中的前端路径 fallback 到 `index.html`。
- API 和 WebSocket 路由不被静态资源 fallback 覆盖。

## 跨平台 binary 发布

新增 GitHub Actions workflow，例如 `.github/workflows/binaries.yml`。

触发方式：

- `push` 到 `main`
- `push` tag `v*`
- `workflow_dispatch`

产物平台：

- `fzfetch-linux-x86_64`
- `fzfetch-linux-aarch64`
- `fzfetch-macos-x86_64`
- `fzfetch-macos-aarch64`
- `fzfetch-windows-x86_64.exe`
- `fzfetch-windows-aarch64.exe`

推荐构建目标：

- `x86_64-unknown-linux-gnu`
- `aarch64-unknown-linux-gnu`
- `x86_64-apple-darwin`
- `aarch64-apple-darwin`
- `x86_64-pc-windows-msvc`
- `aarch64-pc-windows-msvc`

Linux ARM64 交叉编译如果直接在 GitHub-hosted runner 上配置成本过高，可以使用成熟 action 或 cross 工具完成。macOS 和 Windows 的双架构构建分别放在对应系统 runner 上，以减少链路复杂度。

每个 artifact 只上传单个可执行文件，不额外打包 `frontend/dist`。

## 配置文件支持

新增 TOML 配置文件支持：

- 默认尝试读取当前工作目录下的 `fzfetch.toml`。
- 文件不存在时不报错，继续使用默认值和环境变量。
- 支持通过 `FZFETCH_CONFIG` 指定配置文件路径。
- 如果显式指定的配置文件不存在或无法解析，则启动失败并返回明确错误。

配置优先级：

1. 内置默认值
2. `fzfetch.toml` 或 `FZFETCH_CONFIG` 指定的 TOML 文件
3. `FZFETCH_*` 环境变量

配置文件字段：

```toml
root_dir = "files"
data_dir = "data"
exclude_dirs = ["tmp", "cache/private"]

refresh_ttl_secs = 86400
idle_ttl_secs = 1800
cleanup_interval_secs = 60
top_k = 100
nucleo_threads = 4
```

环境变量继续使用现有名称：

- `FZFETCH_ROOT`
- `FZFETCH_DATA_DIR`
- `FZFETCH_EXCLUDE_DIRS`
- `FZFETCH_REFRESH_TTL_SECS`
- `FZFETCH_IDLE_TTL_SECS`
- `FZFETCH_CLEANUP_INTERVAL_SECS`
- `FZFETCH_TOP_K`
- `FZFETCH_NUCLEO_THREADS`
- `FZFETCH_CONFIG`

`FZFETCH_EXCLUDE_DIRS` 仍保持逗号分隔格式。配置文件中的 `exclude_dirs` 使用 TOML 数组表达。

## 样例配置文件

仓库新增 `fzfetch.example.toml`，展示所有支持字段及默认含义。

不提交真实 `fzfetch.toml`，避免开发者本地配置误入版本库。

## Docker 兼容性

已有 Docker image workflow 保留。

Dockerfile 可以继续把 `frontend/dist` 复制进镜像，也可以在 Rust binary 内嵌前端后删掉 runtime 阶段的静态文件复制。为了降低本次变更风险，推荐先保持 Docker 行为兼容：即使 binary 已经内嵌前端，镜像仍可正常运行。

配置文件支持不改变 Docker 默认环境变量：

- `FZFETCH_ROOT=/files`
- `FZFETCH_DATA_DIR=/data`

容器用户仍可通过环境变量覆盖配置。

## 错误处理

- 默认 `fzfetch.toml` 不存在：忽略。
- `FZFETCH_CONFIG` 指向不存在文件：启动失败。
- TOML 解析失败：启动失败并指出配置文件路径。
- 数值字段无法解析或非法：启动失败。
- `nucleo_threads = 0`：启动失败。
- `exclude_dirs` 中指向根目录外的路径：沿用现有行为，忽略该项。

## 测试策略

后端测试：

- 配置文件缺失时保持默认值。
- `fzfetch.toml` 能覆盖默认值。
- 环境变量能覆盖配置文件。
- `FZFETCH_CONFIG` 能指定配置文件路径。
- 显式配置文件缺失时报错。
- `nucleo_threads = 0` 报错。
- 内嵌静态资源 fallback 行为正确。

构建验证：

- `npm --prefix frontend ci`
- `npm --prefix frontend run build`
- `cargo test`
- `cargo build --release`

workflow 验证：

- YAML 能被解析。
- matrix 覆盖 6 个目标平台。
- artifact 名称与目标平台一致。
- 每个 job 在 Rust 构建前先构建前端。

## 最终设计决策

采用“内嵌前端资源 + 单文件跨平台 binary + TOML 配置文件”的方案。

配置优先级固定为：

```text
默认值 < 配置文件 < 环境变量
```

发布目标覆盖 Linux、macOS、Windows 的 x86_64 和 ARM64。Windows ARM64 产物命名为 `fzfetch-windows-aarch64.exe`。
