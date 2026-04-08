# Fzfetch Single-Image Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add single-image deployment support where the Rust server also serves the built frontend, while keeping local defaults at `./files` and `./data` and container defaults at `/files` and `/data` via environment variables.

**Architecture:** Move HTTP app construction into reusable library code so tests and `main` share the same router. Extend runtime config to derive `cache.txt` from `FZFETCH_DATA_DIR`, create missing root/data directories during startup, and use an Axum static-file fallback for the built frontend. Package the frontend build output and Rust binary into one runtime image.

**Tech Stack:** Rust, Axum, Tower HTTP static-file service, Vite, Docker, Docker Compose

---

### Task 1: Lock path defaults and startup directory creation with tests

**Files:**
- Modify: `tests/cache_scanner.rs`
- Modify: `src/config.rs`
- Modify: `src/cache.rs`

- [ ] **Step 1: Write failing tests for local defaults and environment-driven paths**

```rust
#[test]
fn config_uses_local_default_directories() {
    let config = fzfetch::config::AppConfig::default_for(PathBuf::from("/tmp/root"));
    assert_eq!(config.root_dir, PathBuf::from("/tmp/root"));
    assert_eq!(config.data_dir, PathBuf::from("data"));
    assert_eq!(config.cache_file, PathBuf::from("data/cache.txt"));
}

#[test]
fn ensure_runtime_dirs_creates_missing_root_dir() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("files");
    let data_dir = temp.path().join("data");
    let mut config = fzfetch::config::AppConfig::default_for(root.clone());
    config.data_dir = data_dir.clone();
    config.cache_file = data_dir.join("cache.txt");

    config.ensure_runtime_dirs().unwrap();

    assert!(root.is_dir());
    assert!(data_dir.is_dir());
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test config_uses_local_default_directories ensure_runtime_dirs_creates_missing_root_dir -- --exact`
Expected: FAIL because `ensure_runtime_dirs` does not exist and the defaults are not fully asserted by code yet.

- [ ] **Step 3: Implement minimal config support for local defaults and directory preparation**

```rust
pub fn default_for(root_dir: PathBuf) -> Self {
    Self {
        root_dir: root_dir.clone(),
        canonical_root_dir: std::fs::canonicalize(&root_dir).unwrap_or(root_dir),
        data_dir: PathBuf::from("data"),
        cache_file: PathBuf::from("data/cache.txt"),
        // existing duration defaults...
    }
}

pub fn from_env() -> anyhow::Result<Self> {
    let root_dir = std::env::var("FZFETCH_ROOT").unwrap_or_else(|_| "files".to_string());
    let data_dir = std::env::var("FZFETCH_DATA_DIR").unwrap_or_else(|_| "data".to_string());
    let mut config = Self::default_for(root_dir.into());
    config.data_dir = data_dir.into();
    config.cache_file = config.data_dir.join("cache.txt");
    // existing ttl parsing...
    Ok(config)
}

pub fn ensure_runtime_dirs(&mut self) -> anyhow::Result<()> {
    std::fs::create_dir_all(&self.root_dir)?;
    std::fs::create_dir_all(&self.data_dir)?;
    self.canonical_root_dir = std::fs::canonicalize(&self.root_dir)?;
    Ok(())
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test config_uses_local_default_directories ensure_runtime_dirs_creates_missing_root_dir -- --exact`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/cache_scanner.rs src/config.rs src/cache.rs
git commit -m "feat: add configurable runtime path defaults"
```

### Task 2: Lock frontend static serving behavior with router tests

**Files:**
- Create: `tests/http_app.rs`
- Create: `src/web.rs`
- Modify: `src/lib.rs`
- Modify: `src/main.rs`
- Modify: `Cargo.toml`

- [ ] **Step 1: Write failing tests for SPA index serving and API route preservation**

```rust
#[tokio::test]
async fn app_serves_index_for_unknown_frontend_route() {
    let temp = tempfile::tempdir().unwrap();
    let web_dir = temp.path().join("dist");
    std::fs::create_dir_all(&web_dir).unwrap();
    std::fs::write(web_dir.join("index.html"), "<html>spa</html>").unwrap();

    let app = fzfetch::web::build_app(state, &web_dir);
    let response = app.oneshot(Request::builder().uri("/search").body(Body::empty()).unwrap()).await.unwrap();

    assert_eq!(response.status(), StatusCode::OK);
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --test http_app`
Expected: FAIL because the shared app builder and static fallback do not exist.

- [ ] **Step 3: Implement shared router and static fallback**

```rust
pub fn build_app(state: Arc<AppState>, web_dir: impl AsRef<Path>) -> Router {
    let web_dir = web_dir.as_ref().to_path_buf();
    let index_file = web_dir.join("index.html");

    Router::new()
        .route("/ws", get(ws_handler))
        .route("/download", get(download_handler))
        .fallback_service(get_service(
            ServeDir::new(&web_dir).not_found_service(ServeFile::new(index_file)),
        ))
        .with_state(state)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --test http_app`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/http_app.rs src/web.rs src/lib.rs src/main.rs Cargo.toml
git commit -m "feat: serve frontend from rust app"
```

### Task 3: Add container artifacts for single-image deployment

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Modify: `.gitignore`

- [ ] **Step 1: Write the deployment artifacts with explicit runtime defaults**

```dockerfile
ENV FZFETCH_ROOT=/files
ENV FZFETCH_DATA_DIR=/data
WORKDIR /app
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist
COPY --from=rust-builder /app/target/release/fzfetch /usr/local/bin/fzfetch
CMD ["fzfetch"]
```

```yaml
services:
  fzfetch:
    build: .
    ports:
      - "3000:3000"
    environment:
      FZFETCH_ROOT: /files
      FZFETCH_DATA_DIR: /data
    volumes:
      - ./files:/files
      - fzfetch-data:/data
```

- [ ] **Step 2: Run build-oriented verification**

Run: `docker compose config`
Expected: PASS with resolved service configuration

Run: `cargo build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add Dockerfile docker-compose.yml .gitignore
git commit -m "feat: add single-image docker deployment"
```

### Task 4: Final verification

**Files:**
- Modify: `src/main.rs`
- Modify: `tests/cache_scanner.rs`
- Modify: `tests/http_app.rs`
- Modify: `Dockerfile`
- Modify: `docker-compose.yml`

- [ ] **Step 1: Run the focused Rust test suite**

Run: `cargo test`
Expected: PASS

- [ ] **Step 2: Run the frontend build**

Run: `npm --prefix frontend run build`
Expected: PASS with generated `frontend/dist`

- [ ] **Step 3: Run the Docker config and image build**

Run: `docker compose config`
Expected: PASS

Run: `docker build -t fzfetch:test .`
Expected: PASS

- [ ] **Step 4: Inspect resulting paths and startup defaults**

Run: `docker run --rm fzfetch:test env | rg '^FZFETCH_(ROOT|DATA_DIR)='`
Expected:

```text
FZFETCH_ROOT=/files
FZFETCH_DATA_DIR=/data
```

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-04-08-dockerized-single-image-deploy.md
git commit -m "docs: add deployment implementation plan"
```
