# Results List Overflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make search results easier to scan by decoupling row selection from download, expanding the selected item inline, and truncating unselected paths only when their measured width does not fit.

**Architecture:** Keep the backend protocol unchanged and implement the whole feature in the frontend. Use a path-display utility for basename extraction plus width-aware truncation, and add a small measurement hook that observes the real path-line width and recomputes unselected path text when the layout changes.

**Tech Stack:** React 18, TypeScript, Vitest, Testing Library, Tailwind CSS

---

## File Structure

- `frontend/src/App.tsx`
  - Update result-row interaction, path rendering, tooltip/title, and inline selected-row expansion.
- `frontend/src/pathDisplay.ts`
  - Helpers for basename extraction, middle-ellipsis path formatting, and width-aware truncation selection.
- `frontend/src/pathDisplay.test.ts`
  - Unit tests for cross-platform basename handling, truncation output, and width-aware fitting.
- `frontend/src/hooks/useMeasuredPathDisplay.ts`
  - Measure the real path-line width and expose width-aware unselected path display values.
- `frontend/src/hooks/useDownload.ts`
  - Reuse basename helper so download filenames no longer depend on `'/'` splitting.
- `frontend/src/App.test.tsx`
  - Integration-style UI tests for row selection, explicit download, inline expansion, and width-aware path display.

### Task 4: Add width-aware path measurement and truncation

**Files:**
- Create: `frontend/src/hooks/useMeasuredPathDisplay.ts`
- Modify: `frontend/src/pathDisplay.ts`
- Modify: `frontend/src/pathDisplay.test.ts`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/App.test.tsx`
- Test: `frontend/src/pathDisplay.test.ts`
- Test: `frontend/src/App.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add a width-fitting unit test:

```ts
it('returns the full path when the measured width is sufficient', () => {
  const path = '/very/long/workspace/frontend/src/components/report-item.tsx';
  expect(fitPathToWidth(path, path.length, (value) => value.length)).toBe(path);
});

it('falls back to middle ellipsis when the measured width is too small', () => {
  const path = '/very/long/workspace/frontend/src/components/report-item.tsx';
  expect(fitPathToWidth(path, 28, (value) => value.length)).toBe('/very/.../report-item.tsx');
});
```

Add an app-level test with mocked `ResizeObserver` and canvas measurement:

```tsx
it('shows the full unselected path when the measured width is wide enough', () => {
  resizeObserverState.probeWidth = 120;
  searchSocketState.initialResults = [
    { path: '/very/long/workspace/frontend/src/components/report-item.tsx', score: 1, size_bytes: 10 },
  ];

  render(<App />);

  expect(screen.getByTestId('result-path-0')).toHaveTextContent(
    '/very/long/workspace/frontend/src/components/report-item.tsx'
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix frontend test -- --run src/pathDisplay.test.ts src/App.test.tsx`
Expected: FAIL because no width-aware fitting helper exists and the app still uses fixed-length truncation.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/hooks/useMeasuredPathDisplay.ts`:

```ts
export function useMeasuredPathDisplay() {
  const probeRef = useRef<HTMLDivElement | null>(null);
  const [availableWidth, setAvailableWidth] = useState(0);
  const [font, setFont] = useState('');

  useLayoutEffect(() => {
    const probe = probeRef.current;
    if (!probe) return;
    const observer = new ResizeObserver(([entry]) => {
      setAvailableWidth(entry.contentRect.width);
      setFont(window.getComputedStyle(probe).font);
    });
    observer.observe(probe);
    return () => observer.disconnect();
  }, []);

  return { probeRef, availableWidth, font };
}
```

Update `App.tsx` to compute:

```ts
const displayedPath = isSelected
  ? item.path
  : fitPathToWidth(item.path, availablePathWidth, measureText);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix frontend test -- --run src/pathDisplay.test.ts src/App.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useMeasuredPathDisplay.ts frontend/src/pathDisplay.ts frontend/src/pathDisplay.test.ts frontend/src/App.tsx frontend/src/App.test.tsx
git commit -m "feat: make path truncation width-aware"
```

### Task 1: Add path display utility tests

**Files:**
- Create: `frontend/src/pathDisplay.ts`
- Create: `frontend/src/pathDisplay.test.ts`
- Test: `frontend/src/pathDisplay.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';

import { basenameFromPath, middleEllipsisPath } from './pathDisplay';

describe('pathDisplay', () => {
  it('extracts basenames from posix and windows-like paths', () => {
    expect(basenameFromPath('/tmp/demo.txt')).toBe('demo.txt');
    expect(basenameFromPath('C:\\tmp\\report.pdf')).toBe('report.pdf');
    expect(basenameFromPath('plain-name')).toBe('plain-name');
  });

  it('keeps short paths unchanged', () => {
    expect(middleEllipsisPath('/work/docs/report.md', 32)).toBe('/work/docs/report.md');
  });

  it('shortens long paths from the middle while preserving the tail', () => {
    expect(
      middleEllipsisPath('/very/long/workspace/frontend/src/components/report-item.tsx', 28)
    ).toBe('/very/.../report-item.tsx');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix frontend test -- frontend/src/pathDisplay.test.ts`
Expected: FAIL with `Cannot find module './pathDisplay'` or missing exported functions.

- [ ] **Step 3: Write minimal implementation**

```ts
export function basenameFromPath(path: string) {
  const normalized = path.replaceAll('\\', '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts.at(-1) ?? path;
}

export function middleEllipsisPath(path: string, maxLength = 36) {
  if (path.length <= maxLength) return path;

  const normalized = path.replaceAll('\\', '/');
  const basename = basenameFromPath(normalized);
  const head = normalized.startsWith('/') ? '/' : '';
  return `${head}${normalized.slice(head.length, head.length + 5)}.../${basename}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix frontend test -- frontend/src/pathDisplay.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pathDisplay.ts frontend/src/pathDisplay.test.ts
git commit -m "feat: add frontend path display helpers"
```

### Task 2: Add failing results-list interaction tests

**Files:**
- Modify: `frontend/src/App.test.tsx`
- Test: `frontend/src/App.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
it('selects a row on click without triggering download', () => {
  const handleDownload = vi.fn();
  searchSocketState.connectionStatus = 'ready';
  searchSocketState.indexStatus = 'ready';
  searchSocketState.workStatus = 'idle';
  searchSocketState.isSearching = false;
  searchSocketState.initialQuery = 'report';
  searchSocketState.initialResults = [
    { path: '/tmp/alpha/report-a.txt', score: 1, size_bytes: 10 },
    { path: '/tmp/beta/report-b.txt', score: 2, size_bytes: 20 },
  ];
  downloadState.handleDownload = handleDownload;

  render(<App />);

  fireEvent.click(screen.getByTestId('result-row-1'));

  expect(handleDownload).not.toHaveBeenCalled();
  expect(screen.getByTestId('result-row-1').className).toContain('border-l-emerald-500');
});

it('downloads only from the explicit action button', () => {
  const handleDownload = vi.fn();
  searchSocketState.connectionStatus = 'ready';
  searchSocketState.indexStatus = 'ready';
  searchSocketState.workStatus = 'idle';
  searchSocketState.isSearching = false;
  searchSocketState.initialQuery = 'report';
  searchSocketState.initialResults = [
    { path: '/tmp/alpha/report-a.txt', score: 1, size_bytes: 10 },
  ];
  downloadState.handleDownload = handleDownload;

  render(<App />);

  fireEvent.click(screen.getByRole('button', { name: '下载 report-a.txt' }));

  expect(handleDownload).toHaveBeenCalledTimes(1);
  expect(handleDownload).toHaveBeenCalledWith(searchSocketState.initialResults[0]);
});

it('shows the selected item full path in the details bar', () => {
  searchSocketState.connectionStatus = 'ready';
  searchSocketState.indexStatus = 'ready';
  searchSocketState.workStatus = 'idle';
  searchSocketState.isSearching = false;
  searchSocketState.initialQuery = 'report';
  searchSocketState.initialResults = [
    { path: '/tmp/alpha/report-a.txt', score: 1, size_bytes: 10 },
    { path: '/tmp/beta/report-b.txt', score: 2, size_bytes: 20 },
  ];

  render(<App />);
  fireEvent.click(screen.getByTestId('result-row-1'));

  expect(screen.getByTestId('selected-item-details')).toHaveTextContent('/tmp/beta/report-b.txt');
});
```

Add the supporting mock state near the existing `useDownload` mock:

```ts
const downloadState = vi.hoisted(() => ({
  handleDownload: vi.fn(),
}));

vi.mock('./hooks/useDownload', () => {
  return {
    useDownload: () => ({
      handleDownload: downloadState.handleDownload,
      downloadingPath: null,
      toast: null,
      setToast: vi.fn(),
    }),
  };
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix frontend test -- frontend/src/App.test.tsx`
Expected: FAIL because rows still download on click, no explicit button name exists, and no details bar is rendered.

- [ ] **Step 3: Write minimal implementation**

```tsx
<div
  data-testid={`result-row-${index}`}
  onClick={() => setSelectedIndex(index)}
>
  <button
    type="button"
    aria-label={`下载 ${basename}`}
    onClick={(event) => {
      event.stopPropagation();
      handleDownload(item);
    }}
  />
</div>
```

and:

```tsx
{results[selectedIndex] && (
  <div data-testid="selected-item-details">
    {results[selectedIndex].path}
  </div>
)}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix frontend test -- frontend/src/App.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.test.tsx frontend/src/App.tsx
git commit -m "feat: separate row selection from download"
```

### Task 3: Implement formatted path display and details bar layout

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/hooks/useDownload.ts`
- Modify: `frontend/src/App.test.tsx`
- Test: `frontend/src/App.test.tsx`
- Test: `frontend/src/pathDisplay.test.ts`

- [ ] **Step 1: Extend tests for truncation and tooltip behavior**

```tsx
it('renders a shortened secondary path but keeps the full path in a tooltip', () => {
  searchSocketState.connectionStatus = 'ready';
  searchSocketState.indexStatus = 'ready';
  searchSocketState.workStatus = 'idle';
  searchSocketState.isSearching = false;
  searchSocketState.initialQuery = 'report';
  searchSocketState.initialResults = [
    {
      path: '/very/long/workspace/frontend/src/components/report-item.tsx',
      score: 1,
      size_bytes: 10,
    },
  ];

  render(<App />);

  const secondary = screen.getByTestId('result-path-0');
  expect(secondary).toHaveAttribute(
    'title',
    '/very/long/workspace/frontend/src/components/report-item.tsx'
  );
  expect(secondary.textContent).toContain('...');
});
```

Add this download filename test in `frontend/src/hooks/useDownload.test.tsx`:

```tsx
it('uses the basename helper for windows-like download names', async () => {
  const onGhostFound = vi.fn<(path: string) => void>();
  const blob = new Blob(['hello'], { type: 'text/plain' });
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    blob: async () => blob,
  })) as unknown as typeof fetch;
  vi.stubGlobal('fetch', fetchMock);

  const createObjectURL = vi.fn(() => 'blob:mock');
  const revokeObjectURL = vi.fn();
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL } as unknown as typeof URL);

  const clickedAnchors: HTMLAnchorElement[] = [];
  const origCreateElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
    const el = origCreateElement(tagName);
    if (tagName === 'a') {
      Object.defineProperty(el, 'click', { value: vi.fn() });
      clickedAnchors.push(el as HTMLAnchorElement);
    }
    return el;
  });

  const h = renderHookHarness(onGhostFound);
  await h.flush();

  await act(async () => {
    await h.getLatest().handleDownload({ path: 'C:\\tmp\\report.pdf', score: 1 });
  });

  expect(clickedAnchors[0]?.download).toBe('report.pdf');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix frontend test -- frontend/src/App.test.tsx frontend/src/hooks/useDownload.test.tsx frontend/src/pathDisplay.test.ts`
Expected: FAIL because the secondary path still renders the raw full path and download naming still uses `'/'` splitting.

- [ ] **Step 3: Write minimal implementation**

Update `frontend/src/App.tsx` to compute basename, formatted path, and selected item details:

```tsx
import { basenameFromPath, middleEllipsisPath } from './pathDisplay';

const selectedItem = results[selectedIndex] ?? null;

const basename = basenameFromPath(item.path);
const secondaryPath = middleEllipsisPath(item.path, 42);
```

Use those values in the row:

```tsx
<div className="flex flex-col min-w-0">
  <div className="truncate text-[13px] leading-4 sm:text-sm sm:leading-4">
    <FuzzyHighlight text={basename} query={query} />
  </div>
  <div
    data-testid={`result-path-${index}`}
    title={item.path}
    className="truncate text-[9px] leading-3 sm:text-[10px] text-zinc-500 italic mt-0.5 font-sans opacity-70"
  >
    {secondaryPath}
  </div>
</div>
```

Add the details bar just above the footer hints:

```tsx
{selectedItem && (
  <div
    data-testid="selected-item-details"
    className="w-full max-w-5xl flex-shrink-0 px-4 sm:px-8 lg:px-10 pb-2 text-[10px] sm:text-[11px] text-zinc-400"
  >
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 px-3 py-2">
      <div className="font-semibold text-zinc-200">{basenameFromPath(selectedItem.path)}</div>
      <div className="break-all text-zinc-500">{selectedItem.path}</div>
    </div>
  </div>
)}
```

Update `frontend/src/hooks/useDownload.ts` to reuse the helper:

```ts
import { basenameFromPath } from '../pathDisplay';

const fileName = basenameFromPath(item.path);
a.download = fileName || 'download';
showToast(`已开始下载: ${fileName}`, 'success');
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix frontend test -- frontend/src/App.test.tsx frontend/src/hooks/useDownload.test.tsx frontend/src/pathDisplay.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.tsx frontend/src/hooks/useDownload.ts frontend/src/App.test.tsx frontend/src/hooks/useDownload.test.tsx frontend/src/pathDisplay.ts frontend/src/pathDisplay.test.ts
git commit -m "feat: improve result list overflow handling"
```

### Task 4: Run full frontend verification

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/App.test.tsx`
- Modify: `frontend/src/hooks/useDownload.ts`
- Modify: `frontend/src/hooks/useDownload.test.tsx`
- Modify: `frontend/src/pathDisplay.ts`
- Modify: `frontend/src/pathDisplay.test.ts`

- [ ] **Step 1: Run the full frontend test suite**

Run: `npm --prefix frontend test -- --run`
Expected: PASS with all frontend tests green.

- [ ] **Step 2: Run the frontend production build**

Run: `npm --prefix frontend run build`
Expected: PASS and emit the Vite build output without TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/App.tsx frontend/src/App.test.tsx frontend/src/hooks/useDownload.ts frontend/src/hooks/useDownload.test.tsx frontend/src/pathDisplay.ts frontend/src/pathDisplay.test.ts
git commit -m "test: verify result list overflow ui changes"
```
