# Exclude Directories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `FZFETCH_EXCLUDE_DIRS` so indexing skips configured directories and every descendant under them.

**Architecture:** Extend `AppConfig` to parse and normalize exclude directories relative to `FZFETCH_ROOT`, then thread the resolved paths into `scan_root_files`. The scanner will use `walkdir` directory-pruning to skip excluded subtrees without touching existing search or download behavior.

**Tech Stack:** Rust, walkdir, anyhow, tempfile, cargo test

---

### Task 1: Add config parsing tests

**Files:**
- Modify: `tests/cache_scanner.rs`
- Test: `tests/cache_scanner.rs`

- [ ] **Step 1: Write the failing tests**

```rust
#[test]
fn from_env_parses_exclude_dirs_and_ignores_empty_items() {
    unsafe {
        std::env::set_var("FZFETCH_ROOT", "/tmp/fzfetch-root");
        std::env::set_var("FZFETCH_EXCLUDE_DIRS", "tmp, nested/cache , ,logs");
    }

    let config = AppConfig::from_env().unwrap();

    assert_eq!(
        config.exclude_dirs,
        vec![
            PathBuf::from("tmp"),
            PathBuf::from("nested/cache"),
            PathBuf::from("logs"),
        ]
    );

    unsafe {
        std::env::remove_var("FZFETCH_EXCLUDE_DIRS");
        std::env::remove_var("FZFETCH_ROOT");
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test from_env_parses_exclude_dirs_and_ignores_empty_items --test cache_scanner -- --exact`
Expected: FAIL because `AppConfig` does not expose `exclude_dirs` yet.

- [ ] **Step 3: Write minimal implementation**

```rust
pub struct AppConfig {
    pub exclude_dirs: Vec<PathBuf>,
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test from_env_parses_exclude_dirs_and_ignores_empty_items --test cache_scanner -- --exact`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/cache_scanner.rs src/config.rs
git commit -m "feat: parse exclude dirs from env"
```

### Task 2: Add scanner exclusion tests

**Files:**
- Modify: `tests/cache_scanner.rs`
- Modify: `src/scanner.rs`
- Modify: `src/state.rs`
- Test: `tests/cache_scanner.rs`

- [ ] **Step 1: Write the failing tests**

```rust
#[test]
fn scan_root_files_skips_excluded_directories_and_descendants() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    let keep = root.join("keep.txt");
    let excluded_dir = root.join("excluded");
    let nested_dir = excluded_dir.join("deep");
    let excluded_file = nested_dir.join("skip.txt");
    let sibling_dir = root.join("sibling");
    let sibling_file = sibling_dir.join("keep.log");

    std::fs::write(&keep, "1").unwrap();
    std::fs::create_dir_all(&nested_dir).unwrap();
    std::fs::write(&excluded_file, "2").unwrap();
    std::fs::create_dir_all(&sibling_dir).unwrap();
    std::fs::write(&sibling_file, "3").unwrap();

    let files = scan_root_files(root, &[excluded_dir]).unwrap();

    assert!(files.contains_key(&keep.canonicalize().unwrap().to_string_lossy().to_string()));
    assert!(files.contains_key(
        &sibling_file
            .canonicalize()
            .unwrap()
            .to_string_lossy()
            .to_string()
    ));
    assert!(!files.contains_key(
        &excluded_file
            .canonicalize()
            .unwrap()
            .to_string_lossy()
            .to_string()
    ));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test scan_root_files_skips_excluded_directories_and_descendants --test cache_scanner -- --exact`
Expected: FAIL because `scan_root_files` does not accept excluded directories yet.

- [ ] **Step 3: Write minimal implementation**

```rust
pub fn scan_root_files(
    root_dir: &Path,
    excluded_dirs: &[PathBuf],
) -> anyhow::Result<HashMap<String, FileRecord>> {
    // skip excluded directory trees
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test scan_root_files_skips_excluded_directories_and_descendants --test cache_scanner -- --exact`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/cache_scanner.rs src/scanner.rs src/state.rs
git commit -m "feat: skip excluded directories during scan"
```

### Task 3: Document the new runtime option and verify

**Files:**
- Modify: `README.md`
- Modify: `docs/backend.md`
- Test: `tests/cache_scanner.rs`

- [ ] **Step 1: Update docs**

```md
| `FZFETCH_EXCLUDE_DIRS` | `` | 逗号分隔的相对目录列表，这些目录及其子目录不会进入索引 |
```

- [ ] **Step 2: Run focused verification**

Run: `cargo test from_env_parses_exclude_dirs_and_ignores_empty_items --test cache_scanner -- --exact`
Expected: PASS

Run: `cargo test scan_root_files_skips_excluded_directories_and_descendants --test cache_scanner -- --exact`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add README.md docs/backend.md
git commit -m "docs: describe exclude dirs configuration"
```
