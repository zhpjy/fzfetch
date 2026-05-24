# Embedded Binaries And Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 生成不依赖磁盘 `frontend/dist` 的单文件 `fzfetch` binary，并新增 `fzfetch.toml` 与 `FZFETCH_SEARCH_DIR` 配置路径。

**Architecture:** 后端配置加载拆成默认值、TOML 文件、环境变量三层合并；静态资源服务从 `ServeDir` 改为 `rust-embed` 驱动的 Axum fallback；CI 在 Rust release build 前构建前端，并按 6 个平台上传单文件 artifact。Docker 保持现有镜像发布链路，但环境变量名同步为 `FZFETCH_SEARCH_DIR`。

**Tech Stack:** Rust 2024, Axum 0.8, Tokio, rust-embed 8.11.0, mime_guess 2.0.5, toml 1.1.2, GitHub Actions, npm/Vite.

---

## File Structure

- Modify `Cargo.toml`: 增加 `rust-embed`、`mime_guess`、`toml` 依赖。
- Modify `src/config.rs`: 实现配置文件模型、三层配置合并、`FZFETCH_SEARCH_DIR` 环境变量、错误路径提示。
- Modify `src/main.rs`: 调用新的配置加载入口，移除 `PathBuf::from("frontend/dist")` 参数，日志字段改为 `search_dir`。
- Modify `src/web.rs`: 用内嵌资源处理静态文件和 SPA fallback，保留 `/ws` 与 `/download` 的显式路由优先级。
- Modify `tests/cache_scanner.rs`: 覆盖 TOML、环境变量优先级、显式配置文件错误、旧名称不兼容。
- Modify `tests/http_app.rs`: 改为测试内嵌资源 fallback，不再依赖临时磁盘 `dist`。
- Create `fzfetch.example.toml`: 展示全部配置字段。
- Modify `Dockerfile`: 保持前端构建与 runtime 静态文件复制，环境变量改为 `FZFETCH_SEARCH_DIR=/files`。
- Create `.github/workflows/binaries.yml`: 构建 6 个目标平台并上传 binary artifact。
- Modify `README.md`, `README_zh.md`, `docs/backend.md`: 更新配置说明、样例和单文件 binary 行为。
- Modify `.gitignore`: 忽略真实 `fzfetch.toml`，保留 `fzfetch.example.toml`。

## Task 1: 配置加载测试先行

**Files:**
- Modify: `tests/cache_scanner.rs`
- Later modify: `src/config.rs`

- [ ] **Step 1: Add failing tests for config file loading**

Append these tests near the existing `from_env_*` tests in `tests/cache_scanner.rs`:

```rust
#[test]
fn from_sources_reads_default_config_file_when_present() {
    let _guard = env_lock().lock().unwrap();
    let temp = tempfile::tempdir().unwrap();
    let old_cwd = std::env::current_dir().unwrap();
    unsafe {
        std::env::remove_var("FZFETCH_CONFIG");
        std::env::remove_var("FZFETCH_SEARCH_DIR");
        std::env::remove_var("FZFETCH_ROOT");
        std::env::remove_var("FZFETCH_DATA_DIR");
        std::env::remove_var("FZFETCH_EXCLUDE_DIRS");
    }
    std::env::set_current_dir(temp.path()).unwrap();
    std::fs::write(
        temp.path().join("fzfetch.toml"),
        r#"
search_dir = "library"
data_dir = "state"
exclude_dirs = ["tmp", "cache/private"]
refresh_ttl_secs = 10
idle_ttl_secs = 20
cleanup_interval_secs = 30
top_k = 40
nucleo_threads = 2
"#,
    )
    .unwrap();

    let config = fzfetch::config::AppConfig::from_sources().unwrap();

    assert_eq!(config.root_dir, PathBuf::from("library"));
    assert_eq!(config.data_dir, PathBuf::from("state"));
    assert_eq!(config.cache_file, PathBuf::from("state/cache.txt"));
    assert_eq!(
        config.exclude_dirs,
        vec![PathBuf::from("tmp"), PathBuf::from("cache/private")]
    );
    assert_eq!(config.refresh_ttl.as_secs(), 10);
    assert_eq!(config.idle_ttl.as_secs(), 20);
    assert_eq!(config.cleanup_interval.as_secs(), 30);
    assert_eq!(config.top_k, 40);
    assert_eq!(config.nucleo_threads, 2);

    std::env::set_current_dir(old_cwd).unwrap();
}

#[test]
fn from_sources_env_overrides_config_file() {
    let _guard = env_lock().lock().unwrap();
    let temp = tempfile::tempdir().unwrap();
    let old_cwd = std::env::current_dir().unwrap();
    unsafe {
        std::env::remove_var("FZFETCH_CONFIG");
        std::env::set_var("FZFETCH_SEARCH_DIR", "env-files");
        std::env::set_var("FZFETCH_DATA_DIR", "env-data");
    }
    std::env::set_current_dir(temp.path()).unwrap();
    std::fs::write(
        temp.path().join("fzfetch.toml"),
        r#"
search_dir = "toml-files"
data_dir = "toml-data"
"#,
    )
    .unwrap();

    let config = fzfetch::config::AppConfig::from_sources().unwrap();

    assert_eq!(config.root_dir, PathBuf::from("env-files"));
    assert_eq!(config.data_dir, PathBuf::from("env-data"));
    assert_eq!(config.cache_file, PathBuf::from("env-data/cache.txt"));

    unsafe {
        std::env::remove_var("FZFETCH_SEARCH_DIR");
        std::env::remove_var("FZFETCH_DATA_DIR");
    }
    std::env::set_current_dir(old_cwd).unwrap();
}

#[test]
fn from_sources_errors_when_explicit_config_is_missing() {
    let _guard = env_lock().lock().unwrap();
    let temp = tempfile::tempdir().unwrap();
    let missing = temp.path().join("missing.toml");
    unsafe {
        std::env::set_var("FZFETCH_CONFIG", &missing);
    }

    let error = fzfetch::config::AppConfig::from_sources()
        .unwrap_err()
        .to_string();

    assert!(error.contains("FZFETCH_CONFIG"));
    assert!(error.contains("missing.toml"));

    unsafe {
        std::env::remove_var("FZFETCH_CONFIG");
    }
}

#[test]
fn from_sources_rejects_root_dir_and_fzfetch_root() {
    let _guard = env_lock().lock().unwrap();
    let temp = tempfile::tempdir().unwrap();
    let old_cwd = std::env::current_dir().unwrap();
    unsafe {
        std::env::remove_var("FZFETCH_CONFIG");
        std::env::remove_var("FZFETCH_SEARCH_DIR");
        std::env::set_var("FZFETCH_ROOT", "legacy");
    }
    std::env::set_current_dir(temp.path()).unwrap();

    let env_error = fzfetch::config::AppConfig::from_sources()
        .unwrap_err()
        .to_string();
    assert!(env_error.contains("FZFETCH_ROOT"));

    unsafe {
        std::env::remove_var("FZFETCH_ROOT");
    }
    std::fs::write(temp.path().join("fzfetch.toml"), "root_dir = \"legacy\"\n").unwrap();

    let toml_error = fzfetch::config::AppConfig::from_sources()
        .unwrap_err()
        .to_string();
    assert!(toml_error.contains("root_dir"));

    std::env::set_current_dir(old_cwd).unwrap();
}
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
rtk cargo test from_sources --test cache_scanner
```

Expected: FAIL because `AppConfig::from_sources` does not exist.

- [ ] **Step 3: Commit failing tests**

```bash
rtk git add tests/cache_scanner.rs
rtk git commit -m "test: cover config file loading"
```

## Task 2: 实现 TOML 与环境变量配置合并

**Files:**
- Modify: `Cargo.toml`
- Modify: `src/config.rs`
- Modify: `src/main.rs`
- Modify: `tests/cache_scanner.rs`

- [ ] **Step 1: Add dependencies**

In `Cargo.toml`, add:

```toml
toml = "1.1.2"
```

- [ ] **Step 2: Replace config loading implementation**

Update `src/config.rs` so the public API includes `from_sources()` and keeps `from_env()` as a compatibility wrapper for existing tests until they are renamed:

```rust
use std::path::PathBuf;
use std::time::Duration;

use serde::Deserialize;

#[derive(Debug, Clone)]
pub struct AppConfig {
    pub root_dir: PathBuf,
    pub canonical_root_dir: PathBuf,
    pub data_dir: PathBuf,
    pub cache_file: PathBuf,
    pub exclude_dirs: Vec<PathBuf>,
    pub canonical_exclude_dirs: Vec<PathBuf>,
    pub refresh_ttl: Duration,
    pub idle_ttl: Duration,
    pub cleanup_interval: Duration,
    pub top_k: usize,
    pub nucleo_threads: usize,
    pub force_initial_refresh: bool,
}

#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct FileConfig {
    search_dir: Option<PathBuf>,
    data_dir: Option<PathBuf>,
    exclude_dirs: Option<Vec<PathBuf>>,
    refresh_ttl_secs: Option<u64>,
    idle_ttl_secs: Option<u64>,
    cleanup_interval_secs: Option<u64>,
    top_k: Option<usize>,
    nucleo_threads: Option<usize>,
}

impl AppConfig {
    pub fn default_for(root_dir: PathBuf) -> Self {
        let canonical_root_dir =
            std::fs::canonicalize(&root_dir).unwrap_or_else(|_| root_dir.clone());
        Self {
            root_dir,
            canonical_root_dir,
            data_dir: PathBuf::from("data"),
            cache_file: PathBuf::from("data/cache.txt"),
            exclude_dirs: Vec::new(),
            canonical_exclude_dirs: Vec::new(),
            refresh_ttl: Duration::from_secs(24 * 60 * 60),
            idle_ttl: Duration::from_secs(30 * 60),
            cleanup_interval: Duration::from_secs(60),
            top_k: 100,
            nucleo_threads: 4,
            force_initial_refresh: false,
        }
    }

    pub fn from_sources() -> anyhow::Result<Self> {
        reject_legacy_env()?;
        let mut config = Self::default_for(PathBuf::from("files"));
        if let Some(file_config) = load_file_config()? {
            config.apply_file_config(file_config)?;
        }
        config.apply_env_overrides()?;
        config.cache_file = config.data_dir.join("cache.txt");
        config.refresh_canonical_exclude_dirs();
        Ok(config)
    }

    pub fn from_env() -> anyhow::Result<Self> {
        Self::from_sources()
    }

    fn apply_file_config(&mut self, file: FileConfig) -> anyhow::Result<()> {
        if let Some(search_dir) = file.search_dir {
            self.root_dir = search_dir;
        }
        if let Some(data_dir) = file.data_dir {
            self.data_dir = data_dir;
        }
        if let Some(exclude_dirs) = file.exclude_dirs {
            self.exclude_dirs = exclude_dirs;
        }
        if let Some(seconds) = file.refresh_ttl_secs {
            self.refresh_ttl = Duration::from_secs(seconds);
        }
        if let Some(seconds) = file.idle_ttl_secs {
            self.idle_ttl = Duration::from_secs(seconds);
        }
        if let Some(seconds) = file.cleanup_interval_secs {
            self.cleanup_interval = Duration::from_secs(seconds);
        }
        if let Some(top_k) = file.top_k {
            self.top_k = top_k;
        }
        if let Some(threads) = file.nucleo_threads {
            if threads == 0 {
                anyhow::bail!("nucleo_threads must be greater than zero");
            }
            self.nucleo_threads = threads;
        }
        Ok(())
    }

    fn apply_env_overrides(&mut self) -> anyhow::Result<()> {
        if let Some(value) = read_optional_env_path("FZFETCH_SEARCH_DIR")? {
            self.root_dir = value;
        }
        if let Some(value) = read_optional_env_path("FZFETCH_DATA_DIR")? {
            self.data_dir = value;
        }
        if let Some(value) = read_optional_path_list_env("FZFETCH_EXCLUDE_DIRS")? {
            self.exclude_dirs = value;
        }
        self.refresh_ttl = Duration::from_secs(parse_u64_env(
            "FZFETCH_REFRESH_TTL_SECS",
            self.refresh_ttl.as_secs(),
        )?);
        self.idle_ttl =
            Duration::from_secs(parse_u64_env("FZFETCH_IDLE_TTL_SECS", self.idle_ttl.as_secs())?);
        self.cleanup_interval = Duration::from_secs(parse_u64_env(
            "FZFETCH_CLEANUP_INTERVAL_SECS",
            self.cleanup_interval.as_secs(),
        )?);
        self.top_k = parse_usize_env("FZFETCH_TOP_K", self.top_k)?;
        self.nucleo_threads = parse_nonzero_usize_env("FZFETCH_NUCLEO_THREADS", self.nucleo_threads)?;
        Ok(())
    }
}
```

Keep the existing `ensure_runtime_dirs`, `canonicalize_root_dir`, `refresh_canonical_exclude_dirs`, numeric parsers, and exclude path resolver. Add these helpers below the `impl`:

```rust
fn reject_legacy_env() -> anyhow::Result<()> {
    match std::env::var("FZFETCH_ROOT") {
        Ok(_) => anyhow::bail!("FZFETCH_ROOT is not supported; use FZFETCH_SEARCH_DIR"),
        Err(std::env::VarError::NotPresent) => Ok(()),
        Err(error) => Err(anyhow::anyhow!("failed to read FZFETCH_ROOT: {error}")),
    }
}

fn load_file_config() -> anyhow::Result<Option<FileConfig>> {
    match std::env::var("FZFETCH_CONFIG") {
        Ok(path) => {
            let path = PathBuf::from(path);
            let content = std::fs::read_to_string(&path).map_err(|error| {
                anyhow::anyhow!("failed to read FZFETCH_CONFIG {}: {error}", path.display())
            })?;
            parse_file_config(&path, &content).map(Some)
        }
        Err(std::env::VarError::NotPresent) => {
            let path = PathBuf::from("fzfetch.toml");
            if !path.exists() {
                return Ok(None);
            }
            let content = std::fs::read_to_string(&path).map_err(|error| {
                anyhow::anyhow!("failed to read {}: {error}", path.display())
            })?;
            parse_file_config(&path, &content).map(Some)
        }
        Err(error) => Err(anyhow::anyhow!("failed to read FZFETCH_CONFIG: {error}")),
    }
}

fn parse_file_config(path: &std::path::Path, content: &str) -> anyhow::Result<FileConfig> {
    toml::from_str::<FileConfig>(content)
        .map_err(|error| anyhow::anyhow!("failed to parse {}: {error}", path.display()))
}

fn read_optional_env_path(name: &str) -> anyhow::Result<Option<PathBuf>> {
    match std::env::var(name) {
        Ok(value) => Ok(Some(PathBuf::from(value))),
        Err(std::env::VarError::NotPresent) => Ok(None),
        Err(error) => Err(anyhow::anyhow!("failed to read {name}: {error}")),
    }
}

fn read_optional_path_list_env(name: &str) -> anyhow::Result<Option<Vec<PathBuf>>> {
    match std::env::var(name) {
        Ok(value) => Ok(Some(
            value
                .split(',')
                .map(str::trim)
                .filter(|item| !item.is_empty())
                .map(PathBuf::from)
                .collect(),
        )),
        Err(std::env::VarError::NotPresent) => Ok(None),
        Err(error) => Err(anyhow::anyhow!("failed to read {name}: {error}")),
    }
}
```

- [ ] **Step 3: Update main to use the new entry point**

In `src/main.rs`, replace `AppConfig::from_env()?` with:

```rust
let mut config = AppConfig::from_sources()?;
```

In the startup log, rename the field:

```rust
search_dir = %config.canonical_root_dir.display(),
```

- [ ] **Step 4: Rename old tests to new environment variable**

In `tests/cache_scanner.rs`, replace `FZFETCH_ROOT` setup/cleanup with `FZFETCH_SEARCH_DIR`, and rename `from_env_honors_root_and_data_dir_overrides` to:

```rust
fn from_env_honors_search_and_data_dir_overrides()
```

Keep assertions against `config.root_dir` unless a later refactor renames the struct field; this task only changes the external configuration surface.

- [ ] **Step 5: Run config tests**

Run:

```bash
rtk cargo test --test cache_scanner
```

Expected: PASS.

- [ ] **Step 6: Commit config implementation**

```bash
rtk git add Cargo.toml Cargo.lock src/config.rs src/main.rs tests/cache_scanner.rs
rtk git commit -m "feat: add toml config loading"
```

## Task 3: 内嵌前端资源服务

**Files:**
- Modify: `Cargo.toml`
- Modify: `src/web.rs`
- Modify: `src/main.rs`
- Modify: `tests/http_app.rs`

- [ ] **Step 1: Add static asset dependencies**

In `Cargo.toml`, add:

```toml
mime_guess = "2.0.5"
rust-embed = "8.11.0"
```

- [ ] **Step 2: Write web tests against embedded routing contract**

In `tests/http_app.rs`, remove the `web_dir` fixture parameter and update the helper:

```rust
fn build_app(root_dir: &Path) -> Router {
    let state = Arc::new(AppState::new(build_config(root_dir)));
    fzfetch::web::build_app(state)
}
```

Update existing requests to call `build_app(&root)`. Keep these assertions:

```rust
assert_eq!(response.status(), StatusCode::OK);
assert!(String::from_utf8_lossy(&body).contains("<!doctype html"));
```

For the asset test, request an asset path that exists in the built `frontend/dist` after running the frontend build. If the hashed asset name changes, use the first path under `frontend/dist/assets/` from `std::fs::read_dir("frontend/dist/assets")` and request it. Assert `StatusCode::OK` and non-empty body:

```rust
assert!(!body.is_empty());
```

- [ ] **Step 3: Build frontend before compiling tests**

Run:

```bash
rtk npm --prefix frontend ci
rtk npm --prefix frontend run build
rtk cargo test --test http_app
```

Expected: FAIL before `src/web.rs` changes because `build_app` still requires a `web_dir` argument.

- [ ] **Step 4: Implement embedded static service**

Replace `src/web.rs` with an embedded asset handler:

```rust
use std::sync::Arc;

use axum::body::Body;
use axum::http::{HeaderValue, StatusCode, Uri, header};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use rust_embed::RustEmbed;

use crate::api::download_handler;
use crate::state::AppState;
use crate::ws::ws_handler;

#[derive(RustEmbed)]
#[folder = "frontend/dist"]
struct FrontendAssets;

pub fn build_app(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/ws", get(ws_handler))
        .route("/download", get(download_handler))
        .fallback(static_handler)
        .with_state(state)
}

async fn static_handler(uri: Uri) -> Response {
    let path = asset_path(uri.path());
    match FrontendAssets::get(&path) {
        Some(asset) => asset_response(&path, asset.data.into_owned()),
        None => match FrontendAssets::get("index.html") {
            Some(index) => asset_response("index.html", index.data.into_owned()),
            None => StatusCode::NOT_FOUND.into_response(),
        },
    }
}

fn asset_path(path: &str) -> String {
    let trimmed = path.trim_start_matches('/');
    if trimmed.is_empty() {
        "index.html".to_string()
    } else {
        trimmed.to_string()
    }
}

fn asset_response(path: &str, bytes: Vec<u8>) -> Response {
    let content_type = mime_guess::from_path(path).first_or_octet_stream();
    let mut response = Body::from(bytes).into_response();
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(content_type.as_ref())
            .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream")),
    );
    response
}
```

- [ ] **Step 5: Update main**

In `src/main.rs`, remove `use std::path::PathBuf;` and replace:

```rust
let app = build_app(state, PathBuf::from("frontend/dist"));
```

with:

```rust
let app = build_app(state);
```

- [ ] **Step 6: Run embedded web tests**

Run:

```bash
rtk npm --prefix frontend run build
rtk cargo test --test http_app
```

Expected: PASS.

- [ ] **Step 7: Commit embedded web service**

```bash
rtk git add Cargo.toml Cargo.lock src/web.rs src/main.rs tests/http_app.rs
rtk git commit -m "feat: embed frontend assets"
```

Do not commit `frontend/dist`; `rust-embed` reads it at compile time, and CI/local build steps generate it before `cargo build`.

## Task 4: 样例配置与文档

**Files:**
- Create: `fzfetch.example.toml`
- Modify: `.gitignore`
- Modify: `README.md`
- Modify: `README_zh.md`
- Modify: `docs/backend.md`

- [ ] **Step 1: Create sample config**

Create `fzfetch.example.toml`:

```toml
# Directory scanned by fzfetch.
search_dir = "files"

# Application state directory. The cache file is always data_dir/cache.txt.
data_dir = "data"

# Directories excluded from indexing, relative to search_dir.
exclude_dirs = ["tmp", "cache/private"]

# Cache expiration in seconds.
refresh_ttl_secs = 86400

# Idle lifetime before the in-memory index is unloaded.
idle_ttl_secs = 1800

# Cleanup loop interval in seconds.
cleanup_interval_secs = 60

# Maximum number of search results.
top_k = 100

# Number of nucleo matcher threads. Must be greater than zero.
nucleo_threads = 4
```

- [ ] **Step 2: Ignore local config file**

Add this line to `.gitignore`:

```gitignore
fzfetch.toml
```

- [ ] **Step 3: Update README files**

In `README.md` and `README_zh.md`:

- Replace `FZFETCH_ROOT` with `FZFETCH_SEARCH_DIR`.
- Add `FZFETCH_CONFIG` to the configuration table.
- Add a short note that `fzfetch.toml` is optional, defaulted from the current working directory, and overridden by `FZFETCH_*` environment variables.
- Add a note that release binaries serve the embedded frontend and do not require a separate `frontend/dist` directory.

- [ ] **Step 4: Update backend docs**

In `docs/backend.md`:

- Replace “根目录” configuration naming with “搜索目录” where it describes user-facing config.
- Replace `FZFETCH_ROOT` with `FZFETCH_SEARCH_DIR`.
- Add the precedence line:

```text
默认值 < fzfetch.toml 或 FZFETCH_CONFIG 指定文件 < FZFETCH_* 环境变量
```

- [ ] **Step 5: Verify docs references**

Run:

```bash
rtk rg -n "FZFETCH_ROOT|root_dir =|root_dir" README.md README_zh.md docs/backend.md fzfetch.example.toml
```

Expected: no matches for `FZFETCH_ROOT` or `root_dir =`; internal Rust field names outside docs may still contain `root_dir`.

- [ ] **Step 6: Commit docs**

```bash
rtk git add .gitignore fzfetch.example.toml README.md README_zh.md docs/backend.md
rtk git commit -m "docs: document config file support"
```

## Task 5: Docker 与 binary workflow

**Files:**
- Modify: `Dockerfile`
- Create: `.github/workflows/binaries.yml`

- [ ] **Step 1: Update Docker environment names**

In `Dockerfile`, replace:

```dockerfile
ENV FZFETCH_ROOT=/files
```

with:

```dockerfile
ENV FZFETCH_SEARCH_DIR=/files
```

Keep the existing frontend builder and runtime `COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist` for compatibility.

- [ ] **Step 2: Add binary workflow**

Create `.github/workflows/binaries.yml`:

```yaml
name: Build binaries

on:
  push:
    branches:
      - main
    tags:
      - 'v*'
  workflow_dispatch:

permissions:
  contents: read

jobs:
  build:
    name: ${{ matrix.artifact }}
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: ubuntu-latest
            target: x86_64-unknown-linux-gnu
            artifact: fzfetch-linux-x86_64
            binary: fzfetch
          - os: ubuntu-24.04-arm
            target: aarch64-unknown-linux-gnu
            artifact: fzfetch-linux-aarch64
            binary: fzfetch
          - os: macos-13
            target: x86_64-apple-darwin
            artifact: fzfetch-macos-x86_64
            binary: fzfetch
          - os: macos-14
            target: aarch64-apple-darwin
            artifact: fzfetch-macos-aarch64
            binary: fzfetch
          - os: windows-2022
            target: x86_64-pc-windows-msvc
            artifact: fzfetch-windows-x86_64.exe
            binary: fzfetch.exe
          - os: windows-11-arm
            target: aarch64-pc-windows-msvc
            artifact: fzfetch-windows-aarch64.exe
            binary: fzfetch.exe

    steps:
      - uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5

      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
        with:
          node-version: '20'
          cache: npm
          cache-dependency-path: frontend/package-lock.json

      - name: Install Rust target
        run: rustup target add ${{ matrix.target }}

      - name: Install frontend dependencies
        run: npm --prefix frontend ci

      - name: Build frontend
        run: npm --prefix frontend run build

      - name: Build binary
        run: cargo build --release --target ${{ matrix.target }}

      - name: Stage binary
        shell: bash
        run: |
          mkdir -p dist
          cp "target/${{ matrix.target }}/release/${{ matrix.binary }}" "dist/${{ matrix.artifact }}"

      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02
        with:
          name: ${{ matrix.artifact }}
          path: dist/${{ matrix.artifact }}
          if-no-files-found: error
```

- [ ] **Step 3: Record ARM runner access risk**

The workflow uses current GitHub-hosted ARM64 runner labels: `ubuntu-24.04-arm` and `windows-11-arm`. Before merging, verify these labels are available for the repository plan. If either label is unavailable, replace that job with a cross-compilation action or a self-hosted runner.

- [ ] **Step 4: Validate YAML shape locally**

Run:

```bash
rtk ruby -e "require 'yaml'; YAML.load_file('.github/workflows/binaries.yml'); puts 'ok'"
```

Expected: prints `ok`.

- [ ] **Step 5: Commit workflow and Docker changes**

```bash
rtk git add Dockerfile .github/workflows/binaries.yml
rtk git commit -m "ci: build cross platform binaries"
```

## Task 6: End-to-end verification

**Files:**
- No planned source changes unless verification finds a defect.

- [ ] **Step 1: Build frontend**

Run:

```bash
rtk npm --prefix frontend ci
rtk npm --prefix frontend run build
```

Expected: both commands PASS and `frontend/dist/index.html` exists.

- [ ] **Step 2: Run backend tests**

Run:

```bash
rtk cargo test
```

Expected: PASS.

- [ ] **Step 3: Build release binary**

Run:

```bash
rtk cargo build --release
```

Expected: PASS and `target/release/fzfetch` exists.

- [ ] **Step 4: Smoke test config file behavior**

Run:

```bash
rtk sh -c 'tmp="$(mktemp -d)"; printf "search_dir = \"files\"\\ndata_dir = \"data\"\\nnucleo_threads = 1\\n" > "$tmp/fzfetch.toml"; cd "$tmp" && timeout 3s /home/zhpjy/.paseo/worktrees/06jsn4i0/sleek-piranha/target/release/fzfetch'
```

Expected: command times out after startup rather than failing immediately; output includes backend listening log.

- [ ] **Step 5: Final status**

Run:

```bash
rtk git status --short
```

Expected: clean working tree after all task commits.

## Self-Review

- Spec coverage: configuration file support is covered by Tasks 1-2 and Task 4; embedded frontend is covered by Task 3 and Task 6; binary workflow is covered by Task 5; Docker compatibility is covered by Task 5; documentation is covered by Task 4.
- Placeholder scan: the plan contains concrete file paths, commands, expected outcomes, and code/YAML/TOML snippets for each implementation step.
- Type consistency: the external configuration key is consistently `search_dir` / `FZFETCH_SEARCH_DIR`; internal `AppConfig::root_dir` is intentionally retained to reduce implementation blast radius.
