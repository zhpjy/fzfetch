import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const searchSocketState = vi.hoisted(() => ({
  connectionStatus: 'ready' as 'connecting' | 'ready' | 'disconnected' | 'error',
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

describe('App', () => {
  it('does not show No matches found while disconnected', () => {
    searchSocketState.connectionStatus = 'disconnected';
    searchSocketState.workStatus = 'idle';
    searchSocketState.isSearching = false;
    searchSocketState.initialQuery = 'abc';
    searchSocketState.initialResults = [];

    render(<App />);
    expect(screen.queryByText('No matches found')).not.toBeInTheDocument();
  });

  it('shows Waiting for input on empty query', () => {
    searchSocketState.connectionStatus = 'ready';
    searchSocketState.workStatus = 'idle';
    searchSocketState.isSearching = false;
    searchSocketState.initialQuery = '';
    searchSocketState.initialResults = [];

    render(<App />);
    expect(screen.getByText('Waiting for input')).toBeInTheDocument();
  });

  it('shows No matches found when query is non-empty but results are empty', () => {
    searchSocketState.connectionStatus = 'ready';
    searchSocketState.workStatus = 'idle';
    searchSocketState.isSearching = false;
    searchSocketState.initialQuery = '';
    searchSocketState.initialResults = [];

    render(<App />);

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'abc' } });

    expect(screen.getByText('No matches found')).toBeInTheDocument();
  });

  it('passes onEscape to useKeyboardNavigation and clears query when triggered', () => {
    searchSocketState.connectionStatus = 'ready';
    searchSocketState.workStatus = 'idle';
    searchSocketState.isSearching = false;
    searchSocketState.initialQuery = '';
    searchSocketState.initialResults = [];

    render(<App />);

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
    searchSocketState.connectionStatus = 'ready';
    searchSocketState.workStatus = 'idle';
    searchSocketState.isSearching = false;
    searchSocketState.initialQuery = '';
    searchSocketState.initialResults = [];

    render(<App />);
    expect(statusIndicatorState.lastProps).not.toBeNull();
    expect(statusIndicatorState.lastProps).toMatchObject({ connectionStatus: 'ready', workStatus: 'idle' });
    expect('status' in (statusIndicatorState.lastProps ?? {})).toBe(false);
    expect('onRefresh' in (statusIndicatorState.lastProps ?? {})).toBe(false);
  });

  it('renders a dedicated scroll area and keeps footer hints outside it', () => {
    searchSocketState.connectionStatus = 'ready';
    searchSocketState.workStatus = 'idle';
    searchSocketState.isSearching = false;
    searchSocketState.initialQuery = 'abc';
    searchSocketState.initialResults = [{ path: '/tmp/demo.txt', score: 1, size_bytes: 1536 }];

    render(<App />);

    const scrollArea = screen.getByTestId('results-scroll-area');
    const footerHints = screen.getByTestId('footer-hints');

    expect(scrollArea.className).toContain('overflow-y-scroll');
    expect(scrollArea.className).toContain('min-h-0');
    expect(footerHints.className).toContain('flex-shrink-0');
    expect(scrollArea).not.toContainElement(footerHints);
  });

  it('shows file size to the left of the download icon', () => {
    searchSocketState.connectionStatus = 'ready';
    searchSocketState.workStatus = 'idle';
    searchSocketState.isSearching = false;
    searchSocketState.initialQuery = 'demo';
    searchSocketState.initialResults = [{ path: '/tmp/demo.txt', score: 1, size_bytes: 1536 }];

    render(<App />);

    expect(screen.getByText('1.5 KB')).toBeInTheDocument();
  });
});
