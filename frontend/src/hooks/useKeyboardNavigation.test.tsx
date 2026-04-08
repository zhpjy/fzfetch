import React, { useEffect, useState } from 'react';
import { render, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useKeyboardNavigation } from './useKeyboardNavigation';
import { SearchHit } from '../types';

function renderHookHarness(initialResults: SearchHit[]) {
  let latest: ReturnType<typeof useKeyboardNavigation> | null = null;
  let setResults: React.Dispatch<React.SetStateAction<SearchHit[]>> | null = null;

  const onDownload = vi.fn<(item: SearchHit) => void>();
  const onEscape = vi.fn<() => void>();

  function Harness(props: {
    onUpdate: (s: ReturnType<typeof useKeyboardNavigation>) => void;
  }) {
    const [results, _setResults] = useState<SearchHit[]>(initialResults);
    setResults = _setResults;

    const state = useKeyboardNavigation(results, onDownload, onEscape);
    useEffect(() => {
      props.onUpdate(state);
    });
    return null;
  }

  const rendered = render(<Harness onUpdate={(s) => (latest = s)} />);

  return {
    getLatest: () => {
      if (!latest) throw new Error('hook not mounted yet');
      return latest;
    },
    setResults: (next: SearchHit[]) => {
      if (!setResults) throw new Error('setter not mounted yet');
      act(() => setResults!(next));
    },
    onDownload,
    onEscape,
    flush: async () => {
      await act(async () => {
        await Promise.resolve();
      });
    },
    unmount: () => rendered.unmount(),
  };
}

function dispatchKey(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key }));
  });
}

describe('useKeyboardNavigation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('triggers onEscape on Escape even when there are no results', async () => {
    const h = renderHookHarness([]);
    await h.flush();

    dispatchKey('Escape');
    await h.flush();

    expect(h.onEscape).toHaveBeenCalledTimes(1);
  });

  it('does not error when pressing Enter with no results', async () => {
    const h = renderHookHarness([]);
    await h.flush();

    dispatchKey('Enter');
    await h.flush();

    expect(h.onDownload).not.toHaveBeenCalled();
  });

  it('clamps selectedIndex when results shrink so it stays within bounds', async () => {
    const results5: SearchHit[] = Array.from({ length: 5 }, (_, i) => ({
      path: `/tmp/${i}.txt`,
      score: i,
    }));
    const h = renderHookHarness(results5);
    await h.flush();

    // Move selection to the end (index 4).
    dispatchKey('ArrowDown');
    dispatchKey('ArrowDown');
    dispatchKey('ArrowDown');
    dispatchKey('ArrowDown');
    await h.flush();
    expect(h.getLatest().selectedIndex).toBe(4);

    // Shrink results to length 2; selectedIndex should fall back to last valid index (1).
    h.setResults(results5.slice(0, 2));
    await h.flush();
    expect(h.getLatest().selectedIndex).toBe(1);
  });
});

