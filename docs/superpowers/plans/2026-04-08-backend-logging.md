# Fzfetch 后端日志实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Fzfetch 后端补齐结构化分层日志，在默认 `info` 下覆盖关键运行链路，在 `debug` 下覆盖搜索与下载细节。

**Architecture:** 只在现有后端关键入口补结构化 `tracing` 日志，不改动业务协议与状态机。`info` 负责主链路可观测，`debug` 负责高频与敏感细节，`warn/error` 负责异常。搜索原始 `query` 只出现在 `debug`，下载完整路径只出现在 `debug`；`info` 级别下载仅记录 `path_hint`。

**Tech Stack:** Rust、tracing、tracing-subscriber、axum、tokio

---

## 文件结构

### 后端文件

- Modify: `src/main.rs`
- Modify: `src/state.rs`
- Modify: `src/ws.rs`
- Modify: `src/api.rs`
- Create: `tests/logging_helpers.rs`

---

### Task 1: 为日志辅助函数建立测试与最小实现

**Files:**
- Create: `tests/logging_helpers.rs`
- Modify: `src/api.rs`

- [ ] **Step 1: 先写失败测试，锁定 info 级下载路径脱敏规则**

```rust
// tests/logging_helpers.rs
use std::path::Path;

use fzfetch::api::path_hint_for_info;

#[test]
fn path_hint_for_info_prefers_file_name() {
    let hint = path_hint_for_info(Path::new("/tmp/demo/report.pdf"));
    assert_eq!(hint, "report.pdf");
}

#[test]
fn path_hint_for_info_returns_unknown_when_file_name_missing() {
    let hint = path_hint_for_info(Path::new("/"));
    assert_eq!(hint, "<unknown>");
}
```

- [ ] **Step 2: 运行测试确认当前还没有该辅助函数**

Run: `cargo test --test logging_helpers`
Expected: FAIL with unresolved import or missing function

- [ ] **Step 3: 在 `src/api.rs` 写最小辅助函数并导出**

```rust
pub fn path_hint_for_info(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| "<unknown>".to_string())
}
```

- [ ] **Step 4: 运行测试确认辅助函数通过**

Run: `cargo test --test logging_helpers`
Expected: PASS

- [ ] **Step 5: 提交辅助函数基础**

```bash
git add src/api.rs tests/logging_helpers.rs
git commit -m "test: add backend logging helper coverage"
```

### Task 2: 补齐启动、索引生命周期与刷新日志

**Files:**
- Modify: `src/main.rs`
- Modify: `src/state.rs`

- [ ] **Step 1: 在 `main.rs` 补启动主链路 `info` 日志**

包括：
- 配置加载完成
- cache 布局准备完成
- cleanup loop 启动
- 服务监听地址

- [ ] **Step 2: 在 `state.rs` 补索引生命周期日志**

包括：
- 懒加载开始/完成
- 首次空缓存刷新触发
- TTL 刷新触发
- 刷新跳过原因（`debug`）
- 扫描开始/完成
- cache 写回完成
- 广播完成
- 空闲卸载

- [ ] **Step 3: 跑后端测试确认无回归**

Run: `cargo test`
Expected: PASS

- [ ] **Step 4: 提交索引生命周期日志**

```bash
git add src/main.rs src/state.rs
git commit -m "feat: add backend lifecycle logs"
```

### Task 3: 补齐 WebSocket 搜索日志

**Files:**
- Modify: `src/ws.rs`

- [ ] **Step 1: 补 WebSocket 连接与请求日志**

包括：
- 连接建立/关闭 `info`
- 收到搜索请求 `debug`
- 搜索返回命中数 `debug`
- 旧 `req_id` 被丢弃 `debug`
- 刷新广播下发 `debug`

- [ ] **Step 2: 维持现有异常日志并补足缺失字段**

包括：
- 无效消息
- join 失败
- writer 失败
- 序列化失败

- [ ] **Step 3: 跑后端测试**

Run: `cargo test`
Expected: PASS

- [ ] **Step 4: 提交 WebSocket 日志**

```bash
git add src/ws.rs
git commit -m "feat: add websocket search logs"
```

### Task 4: 补齐下载日志并做最终验证

**Files:**
- Modify: `src/api.rs`

- [ ] **Step 1: 补下载主链路日志**

包括：
- 下载请求开始 `info`
- 下载成功 `info`
- `410` / `403` / `404` `info`
- 原始路径、canonicalize、沙箱判定 `debug`

- [ ] **Step 2: 跑格式化与测试验证**

Run: `cargo fmt --check`
Expected: PASS

Run: `cargo test`
Expected: PASS

- [ ] **Step 3: 手工运行验证默认日志级别**

Run: `RUST_LOG=info cargo run`
Expected: 启动日志可见，且无编译错误

- [ ] **Step 4: 提交下载日志与最终验证**

```bash
git add src/api.rs
git commit -m "feat: add backend download logs"
```
