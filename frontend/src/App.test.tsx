import React from 'react';
import { screen, fireEvent, act } from '@testing-library/react';
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

const statusIndicatorState = vi.hoisted(() => ({
  lastProps: null as null | Record<string, unknown>,
}));

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
      handleDownload: vi.fn(),
      downloadingPath: null,
      toast: null,
      setToast: vi.fn(),
    }),
  };
});

vi.mock('./hooks/useKeyboardNavigation', () => {
  return {
    useKeyboardNavigation: (_results: unknown[], _onDownload: unknown, onEscape?: () => void) => {
      kbNavState.lastOnEscape = onEscape;
      return { selectedIndex: 0 };
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

  it('shows file size to the left of the download icon', () => {
    searchSocketState.initialQuery = 'demo';
    searchSocketState.initialResults = [{ path: '/tmp/demo.txt', score: 1, size_bytes: 1536 }];

    renderApp();

    expect(screen.getByText('1.5 KB')).toBeInTheDocument();
  });
});
