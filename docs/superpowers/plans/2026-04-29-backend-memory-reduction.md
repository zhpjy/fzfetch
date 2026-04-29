# 后端内存优化实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变当前前后端协议和搜索语义的前提下，逐项降低搜索与刷新阶段的后端内存占用。

**Architecture:** 先处理搜索阶段最明显的峰值来源，把“全量收集再排序”改成固定 `top_k` 的有界收集。随后收紧 refresh/load 的数据结构，消除缓存快照中路径的重复存储，并把写盘过程改成流式输出。最后补一个 `nucleo` 线程数配置，把 worker 内存放大控制在可预期范围内。

**Tech Stack:** Rust、tokio、axum、nucleo、walkdir、标准库 I/O、cargo test

---

### Task 1: 限制搜索阶段临时结果内存

**Files:**
- Modify: `src/search.rs`
- Test: `src/search.rs`

- [ ] **Step 1: 先写失败测试，锁定“宽查询时只保留 top_k 条结果”的行为**
- [ ] **Step 2: 运行定向测试，确认在改实现前红灯或至少不能证明有界收集**
- [ ] **Step 3: 把 `search()` 从 `collect + sort + take(top_k)` 改成固定容量的候选集**
- [ ] **Step 4: 重新运行 `src/search.rs` 相关测试，确认搜索结果与排序规则保持一致**
- [ ] **Step 5: 提交这一项独立改动**

### Task 2: 收紧 refresh/load 阶段的路径存储

**Files:**
- Modify: `src/cache.rs`
- Modify: `src/scanner.rs`
- Modify: `src/state.rs`
- Modify: `tests/cache_scanner.rs`
- Modify: `tests/index_manager.rs`

- [ ] **Step 1: 先写失败测试，覆盖缓存加载、刷新 diff 和写回后搜索仍然正确**
- [ ] **Step 2: 运行定向测试，确认改动前行为被测试锁住**
- [ ] **Step 3: 把 refresh/load 用的快照结构改成“路径只存一份”的表示**
- [ ] **Step 4: 调整 diff 与 refresh 更新逻辑，保持 `INDEX_REFRESHED` 和现有搜索结果不变**
- [ ] **Step 5: 重新运行缓存与索引管理测试，确认绿灯**
- [ ] **Step 6: 提交这一项独立改动**

### Task 3: 把 cache 快照写盘改成流式输出

**Files:**
- Modify: `src/cache.rs`
- Modify: `tests/cache_scanner.rs`

- [ ] **Step 1: 先补测试，锁定快照输出格式、排序和覆盖写行为**
- [ ] **Step 2: 把 `write_cache_snapshot()` 从整块 `String` 拼接改成 `BufWriter` 流式写**
- [ ] **Step 3: 运行缓存测试，确认输出格式和兼容性不变**
- [ ] **Step 4: 提交这一项独立改动**

### Task 4: 增加 `nucleo` 线程数配置

**Files:**
- Modify: `src/config.rs`
- Modify: `src/search.rs`
- Modify: `tests/cache_scanner.rs`
- Modify: `README.md`
- Modify: `README_zh.md`
- Modify: `docs/backend.md`

- [ ] **Step 1: 先写失败测试，锁定线程数配置的默认值和环境变量解析**
- [ ] **Step 2: 在配置中增加 `FZFETCH_NUCLEO_THREADS`，并把搜索引擎改为显式读取该值**
- [ ] **Step 3: 更新中英文 README 与后端文档，补上新配置说明**
- [ ] **Step 4: 运行配置与文档相关测试，确认绿灯**
- [ ] **Step 5: 提交这一项独立改动**

### Task 5: 最终验证

**Files:**
- Modify: `src/search.rs`
- Modify: `src/cache.rs`
- Modify: `src/scanner.rs`
- Modify: `src/state.rs`
- Modify: `src/config.rs`
- Modify: `tests/cache_scanner.rs`
- Modify: `tests/index_manager.rs`
- Modify: `README.md`
- Modify: `README_zh.md`
- Modify: `docs/backend.md`

- [ ] **Step 1: 运行完整后端测试**
- [ ] **Step 2: 检查工作区，只保留与这组优化相关的改动**
- [ ] **Step 3: 汇总每一项优化对内存来源的影响与剩余风险**
