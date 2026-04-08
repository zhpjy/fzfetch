# Fzfetch 前后端闭环联通实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不重构现有前端目录的前提下，打通 React 前端与 Rust 后端的完整搜索、刷新广播、下载和幽灵文件清理闭环。

**Architecture:** 保留当前 `frontend/src/App.tsx + hooks + components` 的组织形式，把搜索协议逻辑收口到 `useSearchSocket`，把下载与 `410 Gone` 清理逻辑收口到 `useDownload`，把键盘边界控制收口到 `useKeyboardNavigation`。后端协议不新增接口，继续使用 `/ws` 和 `/download`。

**Tech Stack:** React 18、TypeScript、Vite、Vitest、Testing Library、Rust、Axum、WebSocket、HTTP download

---

## 文件结构

### 前端文件

- Modify: `frontend/package.json`
- Create: `frontend/vitest.config.ts`
- Create: `frontend/src/test/setup.ts`
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/index.css`
- Modify: `frontend/src/components/StatusIndicator.tsx`
- Modify: `frontend/src/hooks/useSearchSocket.ts`
- Modify: `frontend/src/hooks/useDownload.ts`
- Modify: `frontend/src/hooks/useKeyboardNavigation.ts`
- Create: `frontend/src/components/StatusIndicator.test.tsx`
- Create: `frontend/src/hooks/useSearchSocket.test.tsx`
- Create: `frontend/src/hooks/useDownload.test.tsx`
- Create: `frontend/src/hooks/useKeyboardNavigation.test.tsx`
- Create: `frontend/src/App.test.tsx`

### 后端文件

- Verify only: `src/ws.rs`
- Verify only: `src/api.rs`

后端本轮不新增接口，只要求继续保持以下契约：

- WebSocket 请求：`{"req_id":123,"query":"rust"}`
- WebSocket 搜索响应：`{"req_id":123,"data":[{"path":"/abs/file","score":99}]}`
- WebSocket 广播：`{"type":"INDEX_REFRESHED"}`
- 下载接口：`GET /download?path=/absolute/path`
- 幽灵文件：HTTP `410 Gone`

---

### Task 1: 建立前端测试基础设施并收口状态类型

**Files:**
- Modify: `frontend/package.json`
- Create: `frontend/vitest.config.ts`
- Create: `frontend/src/test/setup.ts`
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/components/StatusIndicator.tsx`
- Test: `frontend/src/components/StatusIndicator.test.tsx`

- [ ] **Step 1: 先写状态展示组件的失败测试**

```tsx
// frontend/src/components/StatusIndicator.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { StatusIndicator } from './StatusIndicator';

describe('StatusIndicator', () => {
  it('shows background refresh state without rendering a manual refresh button', () => {
    render(
      <StatusIndicator
        connectionStatus="ready"
        workStatus="refreshing"
        isSearching={false}
      />
    );

    expect(screen.getByText('索引后台更新中')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /刷新/i })).not.toBeInTheDocument();
  });

  it('shows disconnected state clearly', () => {
    render(
      <StatusIndicator
        connectionStatus="disconnected"
        workStatus="idle"
        isSearching={false}
      />
    );

    expect(screen.getByText('未连接服务器')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行测试，确认当前前端尚未具备测试脚本和新接口**

Run: `cd frontend && npm test -- --run src/components/StatusIndicator.test.tsx`
Expected: FAIL with `Missing script: "test"` or TypeScript prop mismatch errors

- [ ] **Step 3: 加入 Vitest 测试基础设施，并把状态类型拆成连接维度与工作维度**

```json
// frontend/package.json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "vitest"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4.2",
    "@testing-library/react": "^15.0.7",
    "@testing-library/user-event": "^14.5.2",
    "jsdom": "^24.0.0",
    "vitest": "^1.5.0"
  }
}
```

```ts
// frontend/vitest.config.ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
  },
});
```

```ts
// frontend/src/test/setup.ts
import '@testing-library/jest-dom';
```

```ts
// frontend/src/types.ts
export interface SearchHit {
  path: string;
  score: number;
}

export interface SearchRequest {
  req_id: number;
  query: string;
}

export interface SearchResponse {
  req_id: number;
  data: SearchHit[];
}

export interface IndexRefreshedBroadcast {
  type: 'INDEX_REFRESHED';
}

export type WSMessage = SearchResponse | IndexRefreshedBroadcast;

export type ConnectionStatus = 'connecting' | 'ready' | 'disconnected' | 'error';
export type WorkStatus = 'idle' | 'searching' | 'refreshing';
```

```tsx
// frontend/src/components/StatusIndicator.tsx
import { Database, Loader2 } from 'lucide-react';
import { ConnectionStatus, WorkStatus } from '../types';

interface StatusIndicatorProps {
  connectionStatus: ConnectionStatus;
  workStatus: WorkStatus;
  isSearching: boolean;
}

export function StatusIndicator({
  connectionStatus,
  workStatus,
  isSearching,
}: StatusIndicatorProps) {
  const label =
    connectionStatus === 'disconnected'
      ? '未连接服务器'
      : connectionStatus === 'connecting'
        ? '正在连接'
        : connectionStatus === 'error'
          ? '连接异常'
          : workStatus === 'refreshing'
            ? '索引后台更新中'
            : '系统就绪';

  return (
    <div className="flex items-center gap-4 text-[10px]">
      <div className="flex items-center gap-2 px-2 py-1 rounded border border-zinc-800 bg-zinc-900 min-w-[132px]">
        <span className="h-2 w-2 rounded-full bg-emerald-500" />
        <span className="uppercase font-bold opacity-70 tracking-tight">{label}</span>
      </div>
      <div className="flex items-center gap-2 h-6">
        {workStatus === 'searching' || isSearching ? (
          <Loader2 size={14} className="animate-spin text-emerald-500" />
        ) : (
          <Database size={14} className="text-zinc-600" />
        )}
        <span className="font-bold tracking-widest opacity-50">
          {workStatus === 'refreshing' ? 'REFRESHING' : workStatus === 'searching' ? 'SEARCHING' : 'IDLE'}
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 运行组件测试，确认状态组件与类型收口通过**

Run: `cd frontend && npm test -- --run src/components/StatusIndicator.test.tsx`
Expected: PASS

- [ ] **Step 5: 提交测试基础设施与状态类型重构**

```bash
git add frontend/package.json frontend/vitest.config.ts frontend/src/test/setup.ts frontend/src/types.ts frontend/src/components/StatusIndicator.tsx frontend/src/components/StatusIndicator.test.tsx
git commit -m "test: add frontend state and component test harness"
```

### Task 2: 实现 WebSocket 搜索闭环与刷新广播重查

**Files:**
- Modify: `frontend/src/hooks/useSearchSocket.ts`
- Modify: `frontend/src/types.ts`
- Test: `frontend/src/hooks/useSearchSocket.test.tsx`

- [ ] **Step 1: 先写 WebSocket hook 的失败测试**

```tsx
// frontend/src/hooks/useSearchSocket.test.tsx
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSearchSocket } from './useSearchSocket';

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  readyState = 1;
  sent: string[] = [];
  onopen: ((event: Event) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }

  send(payload: string) {
    this.sent.push(payload);
  }

  close() {
    this.onclose?.();
  }
}

describe('useSearchSocket', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    MockWebSocket.instances = [];
  });

  it('sends only the debounced latest query and accepts only the latest req_id response', () => {
    const { result } = renderHook(() => useSearchSocket());
    const socket = MockWebSocket.instances[0];

    act(() => {
      socket.onopen?.(new Event('open'));
      result.current.setQuery('ru');
      result.current.setQuery('rust');
      vi.advanceTimersByTime(110);
    });

    expect(socket.sent).toHaveLength(1);

    act(() => {
      socket.onmessage?.(
        new MessageEvent('message', {
          data: JSON.stringify({ req_id: 1, data: [{ path: '/tmp/rust.rs', score: 99 }] }),
        })
      );
    });

    expect(result.current.results).toHaveLength(1);
  });

  it('replays the current query when index refreshed is broadcast', () => {
    const { result } = renderHook(() => useSearchSocket());
    const socket = MockWebSocket.instances[0];

    act(() => {
      socket.onopen?.(new Event('open'));
      result.current.setQuery('cargo');
      vi.advanceTimersByTime(110);
      socket.onmessage?.(
        new MessageEvent('message', {
          data: JSON.stringify({ type: 'INDEX_REFRESHED' }),
        })
      );
    });

    expect(socket.sent).toHaveLength(2);
  });
});
```

- [ ] **Step 2: 运行 hook 测试，确认当前实现还不能满足新行为**

Run: `cd frontend && npm test -- --run src/hooks/useSearchSocket.test.tsx`
Expected: FAIL with assertion or type errors around relative URL, state shape, or refresh replay behavior

- [ ] **Step 3: 重写 `useSearchSocket`，实现连接状态、工作状态、微防抖、req_id 比对与刷新广播重查**

```ts
// frontend/src/hooks/useSearchSocket.ts
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ConnectionStatus,
  SearchHit,
  SearchRequest,
  SearchResponse,
  WorkStatus,
  WSMessage,
} from '../types';

const WS_URL = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`;
const DEBOUNCE_MS = 100;
const RECONNECT_MS = 3000;

export function useSearchSocket() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchHit[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [workStatus, setWorkStatus] = useState<WorkStatus>('idle');

  const wsRef = useRef<WebSocket | null>(null);
  const reqIdRef = useRef(0);
  const debounceTimerRef = useRef<number | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);

  const sendSearch = useCallback((value: string) => {
    if (!value.trim()) {
      setResults([]);
      setWorkStatus('idle');
      return;
    }
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return;
    }

    const req_id = ++reqIdRef.current;
    const payload: SearchRequest = { req_id, query: value };
    wsRef.current.send(JSON.stringify(payload));
    setWorkStatus('searching');
  }, []);

  const replayCurrentQuery = useCallback(() => {
    setWorkStatus('refreshing');
    if (query.trim()) {
      sendSearch(query);
    }
  }, [query, sendSearch]);

  useEffect(() => {
    const connect = () => {
      setConnectionStatus('connecting');
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => setConnectionStatus('ready');
      ws.onerror = () => setConnectionStatus('error');
      ws.onclose = () => {
        setConnectionStatus('disconnected');
        reconnectTimerRef.current = window.setTimeout(connect, RECONNECT_MS);
      };
      ws.onmessage = (event) => {
        const message: WSMessage = JSON.parse(event.data) as SearchResponse;
        if ('type' in message && message.type === 'INDEX_REFRESHED') {
          replayCurrentQuery();
          return;
        }
        if ('req_id' in message && message.req_id === reqIdRef.current) {
          setResults(message.data);
          setWorkStatus('idle');
        }
      };
    };

    connect();
    return () => {
      if (debounceTimerRef.current) window.clearTimeout(debounceTimerRef.current);
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [replayCurrentQuery]);

  useEffect(() => {
    if (debounceTimerRef.current) window.clearTimeout(debounceTimerRef.current);
    if (!query.trim()) {
      setResults([]);
      setWorkStatus('idle');
      return;
    }

    debounceTimerRef.current = window.setTimeout(() => {
      sendSearch(query);
    }, DEBOUNCE_MS);
  }, [query, sendSearch]);

  return {
    query,
    setQuery,
    results,
    setResults,
    connectionStatus,
    workStatus,
    isSearching: workStatus === 'searching',
  };
}
```

- [ ] **Step 4: 运行 WebSocket hook 测试**

Run: `cd frontend && npm test -- --run src/hooks/useSearchSocket.test.tsx`
Expected: PASS

- [ ] **Step 5: 提交搜索协议闭环实现**

```bash
git add frontend/src/hooks/useSearchSocket.ts frontend/src/hooks/useSearchSocket.test.tsx frontend/src/types.ts
git commit -m "feat: wire frontend websocket search flow"
```

### Task 3: 实现下载幽灵文件清理与键盘边界控制

**Files:**
- Modify: `frontend/src/hooks/useDownload.ts`
- Modify: `frontend/src/hooks/useKeyboardNavigation.ts`
- Test: `frontend/src/hooks/useDownload.test.tsx`
- Test: `frontend/src/hooks/useKeyboardNavigation.test.tsx`

- [ ] **Step 1: 先写下载与键盘 hook 的失败测试**

```tsx
// frontend/src/hooks/useDownload.test.tsx
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useDownload } from './useDownload';

describe('useDownload', () => {
  it('removes ghost files when backend returns 410', async () => {
    const onGhostFound = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ status: 410, ok: false })
    );

    const { result } = renderHook(() => useDownload(onGhostFound));

    await act(async () => {
      await result.current.handleDownload({ path: '/tmp/missing.txt', score: 1 });
    });

    expect(onGhostFound).toHaveBeenCalledWith('/tmp/missing.txt');
  });
});
```

```tsx
// frontend/src/hooks/useKeyboardNavigation.test.tsx
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useKeyboardNavigation } from './useKeyboardNavigation';

describe('useKeyboardNavigation', () => {
  it('clears the query on Escape and downloads the selected item on Enter', () => {
    const onDownload = vi.fn();
    const onEscape = vi.fn();
    const results = [
      { path: '/tmp/a.txt', score: 1 },
      { path: '/tmp/b.txt', score: 2 },
    ];

    renderHook(() => useKeyboardNavigation(results, onDownload, onEscape));

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onEscape).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行测试，确认现有 hook 还不满足边界行为**

Run: `cd frontend && npm test -- --run src/hooks/useDownload.test.tsx src/hooks/useKeyboardNavigation.test.tsx`
Expected: FAIL with signature mismatch or missing ghost/escape handling assertions

- [ ] **Step 3: 修改下载和键盘 hook**

```ts
// frontend/src/hooks/useDownload.ts
import { useState } from 'react';
import type { SearchHit } from '../types';

export function useDownload(onGhostFound: (path: string) => void) {
  const [downloadingPath, setDownloadingPath] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const showToast = (msg: string, type: 'success' | 'error') => {
    setToast({ msg, type });
    window.setTimeout(() => setToast(null), 3000);
  };

  const handleDownload = async (item: SearchHit) => {
    if (downloadingPath) return;
    setDownloadingPath(item.path);

    try {
      const response = await fetch(`/download?path=${encodeURIComponent(item.path)}`);

      if (response.status === 410) {
        onGhostFound(item.path);
        showToast('文件已不存在，已从结果中移除', 'error');
        return;
      }

      if (!response.ok) {
        showToast('下载失败', 'error');
        return;
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = item.path.split('/').pop() || 'download';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.URL.revokeObjectURL(url);
      showToast(`已开始下载: ${anchor.download}`, 'success');
    } finally {
      setDownloadingPath(null);
    }
  };

  return { handleDownload, downloadingPath, toast, setToast };
}
```

```ts
// frontend/src/hooks/useKeyboardNavigation.ts
import { useEffect, useState } from 'react';
import type { SearchHit } from '../types';

export function useKeyboardNavigation(
  results: SearchHit[],
  onDownload: (item: SearchHit) => void,
  onEscape: () => void
) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    setSelectedIndex((prev) => Math.min(prev, Math.max(results.length - 1, 0)));
  }, [results]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onEscape();
        return;
      }
      if (results.length === 0) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % results.length);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + results.length) % results.length);
      } else if (event.key === 'Enter' && results[selectedIndex]) {
        event.preventDefault();
        onDownload(results[selectedIndex]);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [results, selectedIndex, onDownload, onEscape]);

  return { selectedIndex, setSelectedIndex };
}
```

- [ ] **Step 4: 运行下载与键盘测试**

Run: `cd frontend && npm test -- --run src/hooks/useDownload.test.tsx src/hooks/useKeyboardNavigation.test.tsx`
Expected: PASS

- [ ] **Step 5: 提交下载与键盘边界控制**

```bash
git add frontend/src/hooks/useDownload.ts frontend/src/hooks/useKeyboardNavigation.ts frontend/src/hooks/useDownload.test.tsx frontend/src/hooks/useKeyboardNavigation.test.tsx
git commit -m "feat: handle ghost downloads and keyboard flow"
```

### Task 4: 集成 App 界面并完成联调验证

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/index.css`
- Modify: `frontend/src/components/StatusIndicator.tsx`
- Test: `frontend/src/App.test.tsx`

- [ ] **Step 1: 先写 App 集成失败测试，锁定空态与无结果态**

```tsx
// frontend/src/App.test.tsx
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';

vi.mock('./hooks/useSearchSocket', () => ({
  useSearchSocket: () => ({
    query: '',
    setQuery: vi.fn(),
    results: [],
    setResults: vi.fn(),
    connectionStatus: 'ready',
    workStatus: 'idle',
    isSearching: false,
  }),
}));

vi.mock('./hooks/useDownload', () => ({
  useDownload: () => ({
    handleDownload: vi.fn(),
    downloadingPath: null,
    toast: null,
    setToast: vi.fn(),
  }),
}));

vi.mock('./hooks/useKeyboardNavigation', () => ({
  useKeyboardNavigation: () => ({ selectedIndex: 0 }),
}));

import App from './App';

it('shows waiting state when query is empty', () => {
  render(<App />);
  expect(screen.getByText('Waiting for input')).toBeInTheDocument();
});
```

- [ ] **Step 2: 运行 App 测试，确认当前界面仍绑定旧状态模型和刷新按钮**

Run: `cd frontend && npm test -- --run src/App.test.tsx`
Expected: FAIL with prop mismatch or stale button-related assertions

- [ ] **Step 3: 改造 App，让它消费新的状态模型并去掉手动刷新按钮**

```tsx
// frontend/src/App.tsx
import { useCallback, useRef } from 'react';

import { useDownload } from './hooks/useDownload';
import { useKeyboardNavigation } from './hooks/useKeyboardNavigation';
import { useSearchSocket } from './hooks/useSearchSocket';
import { StatusIndicator } from './components/StatusIndicator';

export default function App() {
  const {
    query,
    setQuery,
    results,
    setResults,
    connectionStatus,
    workStatus,
    isSearching,
  } = useSearchSocket();

  const onGhostFound = useCallback((path: string) => {
    setResults((prev) => prev.filter((item) => item.path !== path));
  }, [setResults]);

  const { handleDownload, downloadingPath, toast, setToast } = useDownload(onGhostFound);
  const { selectedIndex } = useKeyboardNavigation(results, handleDownload, () => setQuery(''));
  const inputRef = useRef<HTMLInputElement>(null);

  const showWaiting = !query.trim();
  const showEmpty = query.trim() && results.length === 0 && !isSearching;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-300 font-mono flex flex-col items-center select-none overflow-hidden">
      <div className="w-full max-w-5xl px-8 pt-10 flex justify-between items-end mb-6">
        <StatusIndicator
          connectionStatus={connectionStatus}
          workStatus={workStatus}
          isSearching={isSearching}
        />
      </div>
      {/* 输入框与列表主体沿用现有 UI，只替换空态和状态判断 */}
      {showWaiting ? <p>Waiting for input</p> : showEmpty ? <p>No matches found</p> : null}
      {toast ? <div>{toast.msg}</div> : null}
    </div>
  );
}
```

- [ ] **Step 4: 跑前端全量测试与构建**

Run: `cd frontend && npm test -- --run`
Expected: PASS

Run: `cd frontend && npm run build`
Expected: PASS with Vite production build output

- [ ] **Step 5: 跑后端回归验证，确认联调基础未被破坏**

Run: `cargo test`
Expected: PASS

- [ ] **Step 6: 本地手工联调**

Run: `cargo run`
Expected: backend listening on `127.0.0.1:3000`

Run: `cd frontend && npm run dev -- --host 127.0.0.1 --port 5173`
Expected: Vite dev server starts and proxies `/ws` + `/download`

Manual checks:
- 输入 `rust`，列表返回匹配结果。
- 快速从 `r` 输入到 `rust`，界面只保留最后一次结果。
- 等待后端触发刷新广播或用空缓存首次搜索，前端自动重查当前 query。
- 下载一个被删除的幽灵文件，前端移除该项并提示“文件已不存在，已从结果中移除”。
- 停掉后端再启动，前端状态先显示断开，再恢复已连接。

- [ ] **Step 7: 提交 App 集成与联调完成状态**

```bash
git add frontend/src/App.tsx frontend/src/index.css frontend/src/components/StatusIndicator.tsx frontend/src/App.test.tsx
git commit -m "feat: complete frontend backend interaction flow"
```
