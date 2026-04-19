import React from 'react';
import { screen, fireEvent, act, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCALE_STORAGE_KEY } from './i18n/types';
import { renderWithI18n } from './test/renderWithI18n';

const searchSocketState = vi.hoisted(() => ({
  connectionStatus: 'ready' as 'connecting' | 'ready' | 'disconnected' | 'error',
  indexStatus: 'ready' as 'unknown' | 'pending' | 'refreshing' | 'ready',
  workStatus: 'idle' as 'idle' | 'searching' | 'refreshing',
  initialQuery: '',
  initialResults: [] as any[],
  isSearching: false,
}));

const kbNavState = vi.hoisted(() => ({
  lastOnEscape: undefined as undefined | (() => void),
}));

const downloadState = vi.hoisted(() => ({
  handleDownload: vi.fn(),
}));

const resizeObserverState = vi.hoisted(() => ({
  probeWidth: 42,
}));

const canvasMeasureState = vi.hoisted(() => ({
  charWidth: 1,
}));

const statusIndicatorState = vi.hoisted(() => ({
  lastProps: null as null | Record<string, unknown>,
}));

class ResizeObserverMock {
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element) {
    this.callback(
      [
        {
          target,
          contentRect: {
            width: resizeObserverState.probeWidth,
            height: 0,
            x: 0,
            y: 0,
            top: 0,
            right: resizeObserverState.probeWidth,
            bottom: 0,
            left: 0,
            toJSON: () => ({}),
          },
        } as ResizeObserverEntry,
      ],
      this as unknown as ResizeObserver,
    );
  }

  unobserve() {}

  disconnect() {}
}

vi.stubGlobal('ResizeObserver', ResizeObserverMock);

Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  configurable: true,
  value: vi.fn(() => ({
    font: '',
    measureText: (text: string) => ({
      width: text.length * canvasMeasureState.charWidth,
    }),
  })),
});

vi.mock('./hooks/useSearchSocket', async () => {
  const React = await import('react');
  return {
    useSearchSocket: () => {
      const [query, setQuery] = React.useState(searchSocketState.initialQuery);
      const [results, setResults] = React.useState<any[]>(searchSocketState.initialResults);
      return {
        query,
        setQuery,
        results,
        setResults,
        connectionStatus: searchSocketState.connectionStatus,
        indexStatus: searchSocketState.indexStatus,
        workStatus: searchSocketState.workStatus,
        isSearching: searchSocketState.isSearching,
      };
    },
  };
});

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

vi.mock('./hooks/useKeyboardNavigation', async () => {
  const React = await import('react');
  return {
    useKeyboardNavigation: (_results: unknown[], _onDownload: unknown, onEscape?: () => void) => {
      kbNavState.lastOnEscape = onEscape;
      const [selectedIndex, setSelectedIndex] = React.useState(0);
      return { selectedIndex, setSelectedIndex };
    },
  };
});

vi.mock('./components/StatusIndicator', async () => {
  const React = await import('react');
  return {
    StatusIndicator: (props: Record<string, unknown>) => {
      statusIndicatorState.lastProps = props;
      return React.createElement('div', { 'data-testid': 'status-indicator' });
    },
  };
});

import App from './App';

function renderApp(initialLocale?: 'en' | 'zh-CN') {
  return renderWithI18n(<App />, initialLocale ? { initialLocale } : undefined);
}

describe('App', () => {
  beforeEach(() => {
    resizeObserverState.probeWidth = 42;
    canvasMeasureState.charWidth = 1;
    downloadState.handleDownload = vi.fn();
    searchSocketState.connectionStatus = 'ready';
    searchSocketState.indexStatus = 'ready';
    searchSocketState.workStatus = 'idle';
    searchSocketState.initialQuery = '';
    searchSocketState.initialResults = [];
    searchSocketState.isSearching = false;
    kbNavState.lastOnEscape = undefined;
    statusIndicatorState.lastProps = null;
    localStorage.clear();
  });

  it('does not show No matches found while disconnected', () => {
    searchSocketState.connectionStatus = 'disconnected';
    searchSocketState.initialQuery = 'abc';

    renderApp();
    expect(screen.queryByText('No matches found')).not.toBeInTheDocument();
  });

  it('renders english placeholder and waiting empty state in en locale', () => {
    renderApp('en');

    expect(screen.getByPlaceholderText('Type to fuzzy search files...')).toBeInTheDocument();
    expect(screen.getByText('Waiting for input')).toBeInTheDocument();
  });

  it('shows No matches found when query is non-empty but results are empty', () => {
    renderApp();

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'abc' } });

    expect(screen.getByText('No matches found')).toBeInTheDocument();
  });

  it('switches locale to zh-CN and persists to localStorage', () => {
    const view = renderApp('en');

    const zhSwitch = screen.getByRole('button', { name: 'Switch to Chinese' });
    const enCurrent = screen.getByRole('button', { name: 'English (current language)' });
    expect(zhSwitch).toHaveAttribute('aria-pressed', 'false');
    expect(enCurrent).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(zhSwitch);

    expect(screen.getByPlaceholderText('输入关键词进行实时模糊搜索...')).toBeInTheDocument();
    expect(screen.getByText('等待输入')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '中文（当前语言）' })).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('zh-CN');

    view.unmount();
    renderApp();
    expect(screen.getByPlaceholderText('输入关键词进行实时模糊搜索...')).toBeInTheDocument();
  });

  it('passes onEscape to useKeyboardNavigation and clears query when triggered', () => {
    renderApp();

    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'abc' } });
    expect(input.value).toBe('abc');

    expect(typeof kbNavState.lastOnEscape).toBe('function');

    act(() => {
      kbNavState.lastOnEscape?.();
    });

    expect(input.value).toBe('');
    expect(screen.getByText('Waiting for input')).toBeInTheDocument();
  });

  it('passes only new props to StatusIndicator', () => {
    renderApp();
    expect(statusIndicatorState.lastProps).not.toBeNull();
    expect(statusIndicatorState.lastProps).toMatchObject({ connectionStatus: 'ready', indexStatus: 'ready', workStatus: 'idle' });
    expect('status' in (statusIndicatorState.lastProps ?? {})).toBe(false);
    expect('onRefresh' in (statusIndicatorState.lastProps ?? {})).toBe(false);
  });

  it('links the brand area to the GitHub repository in a new tab', () => {
    renderApp();

    const brandLink = screen.getByRole('link', { name: 'Open fzfetch on GitHub' });

    expect(brandLink).toHaveAttribute('href', 'https://github.com/zhpjy/fzfetch');
    expect(brandLink).toHaveAttribute('target', '_blank');
    expect(brandLink).toHaveAttribute('rel', 'noreferrer');
  });

  it('renders a dedicated scroll area and keeps footer hints outside it', () => {
    searchSocketState.initialQuery = 'abc';
    searchSocketState.initialResults = [{ path: '/tmp/demo.txt', score: 1, size_bytes: 1536 }];

    renderApp();

    const scrollArea = screen.getByTestId('results-scroll-area');
    const footerHints = screen.getByTestId('footer-hints');

    expect(scrollArea.className).toContain('overflow-y-scroll');
    expect(scrollArea.className).toContain('min-h-0');
    expect(footerHints.className).toContain('flex-shrink-0');
    expect(scrollArea).not.toContainElement(footerHints);
  });

  it('uses a full-width hidden probe so path measurement matches the real text column', () => {
    searchSocketState.initialQuery = 'abc';
    searchSocketState.initialResults = [{ path: '/tmp/demo.txt', score: 1, size_bytes: 1536 }];

    renderApp();

    expect(screen.getByTestId('path-width-probe-container').className).toContain('flex-1');
    expect(screen.getByTestId('path-width-probe').className).toContain('w-full');
  });

  it('shows file size to the left of the download icon', () => {
    searchSocketState.initialQuery = 'demo';
    searchSocketState.initialResults = [{ path: '/tmp/demo.txt', score: 1, size_bytes: 1536 }];

    renderApp();

    expect(screen.getByText('1.5 KB')).toBeInTheDocument();
  });

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

    renderApp();

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

    renderApp();

    fireEvent.click(screen.getByRole('button', { name: '下载 report-a.txt' }));

    expect(handleDownload).toHaveBeenCalledTimes(1);
    expect(handleDownload).toHaveBeenCalledWith(searchSocketState.initialResults[0]);
  });

  it('reuses the existing filename and path lines when a row is selected', () => {
    resizeObserverState.probeWidth = 28;
    searchSocketState.initialQuery = 'report';
    searchSocketState.initialResults = [
      {
        path: '/workspace/alpha/with/a/really/long/path/segment/report-a.txt',
        score: 1,
        size_bytes: 10,
      },
      {
        path: '/workspace/beta/with/a/really/long/path/segment/report-b.txt',
        score: 2,
        size_bytes: 20,
      },
    ];

    renderApp();
    fireEvent.click(screen.getByTestId('result-row-1'));

    const selectedRow = screen.getByTestId('result-row-1');
    const unselectedRow = screen.getByTestId('result-row-0');
    const selectedName = screen.getByTestId('result-name-1');
    const unselectedName = screen.getByTestId('result-name-0');
    const selectedPath = screen.getByTestId('result-path-1');
    const unselectedPath = screen.getByTestId('result-path-0');

    expect(screen.queryByTestId('selected-item-details')).not.toBeInTheDocument();
    expect(selectedPath).toHaveTextContent('/workspace/beta/with/a/really/long/path/segment/report-b.txt');
    expect(selectedPath.className).toContain('whitespace-normal');
    expect(selectedPath.className).not.toContain('truncate');
    expect(unselectedPath.textContent).toContain('...');
    expect(unselectedPath.className).toContain('truncate');
    expect(selectedName.className).toContain('whitespace-normal');
    expect(selectedName.className).not.toContain('truncate');
    expect(unselectedName.className).toContain('truncate');
    expect(within(selectedRow).queryByText('/workspace/beta/with/a/really/long/path/segment/report-b.txt')).toBe(selectedPath);
    expect(within(unselectedRow).queryByText('/workspace/alpha/with/a/really/long/path/segment/report-a.txt')).not.toBeInTheDocument();
  });

  it('shows the full unselected path when the measured width is wide enough', () => {
    resizeObserverState.probeWidth = 120;
    searchSocketState.initialQuery = 'report';
    searchSocketState.initialResults = [
      {
        path: '/tmp/selected-report.txt',
        score: 0,
        size_bytes: 1,
      },
      {
        path: '/very/long/workspace/frontend/src/components/report-item.tsx',
        score: 1,
        size_bytes: 10,
      },
    ];

    renderApp();

    const displayedPath = screen.getByTestId('result-path-1');

    expect(displayedPath).toHaveAttribute(
      'title',
      '/very/long/workspace/frontend/src/components/report-item.tsx',
    );
    expect(displayedPath).toHaveTextContent('/very/long/workspace/frontend/src/components/report-item.tsx');
    expect(displayedPath.textContent).not.toContain('...');
  });

  it('shortens unselected paths only when the measured width is too small', () => {
    resizeObserverState.probeWidth = 28;
    searchSocketState.initialQuery = 'report';
    searchSocketState.initialResults = [
      {
        path: '/tmp/selected-report.txt',
        score: 0,
        size_bytes: 1,
      },
      {
        path: '/very/long/workspace/frontend/src/components/report-item.tsx',
        score: 1,
        size_bytes: 10,
      },
    ];

    renderApp();

    const displayedPath = screen.getByTestId('result-path-1');

    expect(displayedPath).toHaveAttribute(
      'title',
      '/very/long/workspace/frontend/src/components/report-item.tsx',
    );
    expect(displayedPath.textContent).toContain('...');
  });
});
