import React, { useEffect } from 'react';
import { render, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDownload } from './useDownload';
import { SearchHit } from '../types';

function renderHookHarness(onGhostFound: (path: string) => void) {
  let latest: ReturnType<typeof useDownload> | null = null;

  function Harness(props: { onUpdate: (s: ReturnType<typeof useDownload>) => void }) {
    const state = useDownload(onGhostFound);
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
    flush: async () => {
      await act(async () => {
        await Promise.resolve();
      });
    },
    unmount: () => rendered.unmount(),
  };
}

describe('useDownload', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('calls onGhostFound and shows a light hint when server returns 410', async () => {
    const onGhostFound = vi.fn<(path: string) => void>();
    const fetchMock = vi.fn(async () => {
      return { ok: false, status: 410 } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const h = renderHookHarness(onGhostFound);
    await h.flush();

    const item: SearchHit = { path: '/tmp/ghost.txt', score: 1 };
    await act(async () => {
      await h.getLatest().handleDownload(item);
    });
    await h.flush();

    expect(onGhostFound).toHaveBeenCalledTimes(1);
    expect(onGhostFound).toHaveBeenCalledWith(item.path);

    // 410 should not be treated as a generic error; we want a light hint.
    expect(h.getLatest().toast).not.toBeNull();
    expect(h.getLatest().toast?.type).toBe('success');
    expect(h.getLatest().toast?.msg).not.toBe('下载失败');
  });
});

