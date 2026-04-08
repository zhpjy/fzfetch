import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

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
      const [query, setQuery] = React.useState('');
      const [results, setResults] = React.useState<any[]>([]);
      return {
        query,
        setQuery,
        results,
        setResults,
        connectionStatus: 'ready',
        workStatus: 'idle',
        isSearching: false,
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
  it('shows Waiting for input on empty query', () => {
    render(<App />);
    expect(screen.getByText('Waiting for input')).toBeInTheDocument();
  });

  it('shows No matches found when query is non-empty but results are empty', () => {
    render(<App />);

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'abc' } });

    expect(screen.getByText('No matches found')).toBeInTheDocument();
  });

  it('passes onEscape to useKeyboardNavigation and clears query when triggered', () => {
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
    render(<App />);
    expect(statusIndicatorState.lastProps).not.toBeNull();
    expect(statusIndicatorState.lastProps).toMatchObject({ connectionStatus: 'ready', workStatus: 'idle' });
    expect('status' in (statusIndicatorState.lastProps ?? {})).toBe(false);
    expect('onRefresh' in (statusIndicatorState.lastProps ?? {})).toBe(false);
  });
});

