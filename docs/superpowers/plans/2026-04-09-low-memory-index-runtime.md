# Low-Memory Index Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce steady-state backend memory usage while keeping the existing fuzzy-search behavior unchanged.

**Architecture:** Stop storing the full path set twice in memory by removing the runtime `HashSet<String>` copy and treating `cache.txt` as the durable snapshot for refresh diffs. Load cache paths with a buffered reader instead of `read_to_string`, and keep temporary diff sets scoped to the background refresh task.

**Tech Stack:** Rust, tokio, nucleo, std I/O, axum tests

---

### Task 1: Lock the lower-memory runtime behavior with tests

**Files:**
- Modify: `tests/index_manager.rs`

- [ ] **Step 1: Write failing tests that verify cache-backed loading and refresh still work without `runtime.paths`**

```rust
#[tokio::test]
async fn ensure_loaded_builds_search_engine_from_cache() {
    // build cache.txt with two paths
    // ensure_loaded()
    // assert engine.search("alpha", 10) returns alpha
}

#[tokio::test]
async fn refresh_success_updates_cache_and_search_results() {
    // trigger refresh
    // assert cache.txt contains the new path
    // poll search("fresh") until the new path is returned
}
```

- [ ] **Step 2: Run the focused tests and confirm they fail**

Run: `cargo test ensure_loaded_builds_search_engine_from_cache refresh_success_updates_cache_and_search_results`
Expected: FAIL because the current tests and runtime still depend on `runtime.paths`.

- [ ] **Step 3: Commit the red tests only after verifying the failure locally if needed**

### Task 2: Stream cache loading and remove the steady-state duplicate path set

**Files:**
- Modify: `src/cache.rs`
- Modify: `src/state.rs`

- [ ] **Step 1: Replace `read_to_string` cache loading with buffered line iteration**

```rust
let reader = std::io::BufReader::new(fs::File::open(cache_file)?);
for line in reader.lines() { ... }
```

- [ ] **Step 2: Remove `paths: RwLock<HashSet<String>>` from `IndexRuntime`**

```rust
pub struct IndexRuntime {
    pub engine: Mutex<SearchEngine>,
    pub last_used_at: Mutex<Instant>,
    pub last_refresh_at: Mutex<SystemTime>,
    pub refreshing: AtomicBool,
    pub bootstrap_refresh_pending: AtomicBool,
}
```

- [ ] **Step 3: Seed the search engine directly from the loaded cache snapshot and only log `path_count`**

- [ ] **Step 4: During refresh, load old paths from `cache.txt`, scan new paths, diff them, update the engine, and write the new snapshot**

- [ ] **Step 5: Run the focused tests to confirm the runtime still behaves correctly**

Run: `cargo test ensure_loaded_builds_search_engine_from_cache refresh_success_updates_cache_and_search_results`
Expected: PASS

### Task 3: Final verification and release integration

**Files:**
- Modify: `tests/index_manager.rs`
- Modify: `src/cache.rs`
- Modify: `src/state.rs`

- [ ] **Step 1: Run the full backend verification**

Run: `cargo test`
Expected: PASS

- [ ] **Step 2: Commit the implementation**

```bash
git add docs/superpowers/plans/2026-04-09-low-memory-index-runtime.md tests/index_manager.rs src/cache.rs src/state.rs
git commit -m "refactor: reduce steady-state index memory"
```

- [ ] **Step 3: Tag the release**

```bash
git tag v0.9.0
```

- [ ] **Step 4: Push the branch and tag**

```bash
git push origin main
git push origin v0.9.0
```
