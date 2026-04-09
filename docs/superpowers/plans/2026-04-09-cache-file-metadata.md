# Cache File Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store `size_bytes` in the cache snapshot and serve it from memory so search no longer calls `std::fs::metadata` per hit.

**Architecture:** Replace the cache/search/scanner path set with a shared `FileRecord { path, size_bytes }` model. Refresh still scans the filesystem and rewrites the full cache snapshot, but query-time result shaping reads cached metadata directly from indexed records.

**Tech Stack:** Rust, tokio, axum, nucleo, walkdir

---

### Task 1: Introduce Cache Record Model

**Files:**
- Modify: `src/cache.rs`
- Modify: `src/scanner.rs`
- Test: `tests/cache_scanner.rs`

- [ ] Add a shared record type and record-based cache load/write helpers.
- [ ] Update scanner output and diffing to operate on records keyed by path.
- [ ] Add failing tests for reading/writing records and diffing records with preserved metadata.

### Task 2: Switch Search Runtime To Records

**Files:**
- Modify: `src/search.rs`
- Modify: `src/state.rs`
- Test: `src/search.rs`
- Test: `tests/index_manager.rs`

- [ ] Update `SearchEngine` to index records and return cached `size_bytes` without touching the filesystem at search time.
- [ ] Update `IndexManager` load/refresh flow to use record snapshots and record diffs.
- [ ] Add failing tests that prove cached metadata survives missing files and refresh flow.

### Task 3: Verify End-To-End Behavior

**Files:**
- Modify: `docs/backend.md`

- [ ] Update backend documentation to describe the record-based cache snapshot.
- [ ] Run targeted tests for cache/search/index-manager, then run full `cargo test`.
