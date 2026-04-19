import React, { useEffect } from 'react';
import { render, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDownload } from './useDownload';
import { SearchHit } from '../types';
import { I18nProvider } from '../i18n/I18nProvider';
import { Locale } from '../i18n/types';

function renderHookHarness(onGhostFound: (path: string) => void, locale: Locale = 'en') {
  let latest: ReturnType<typeof useDownload> | null = null;

  function Harness(props: { onUpdate: (s: ReturnType<typeof useDownload>) => void }) {
    const state = useDownload(onGhostFound);
    useEffect(() => {
      props.onUpdate(state);
    });
    return null;
  }

  const rendered = render(
    <I18nProvider initialLocale={locale}>
      <Harness onUpdate={(s) => (latest = s)} />
    </I18nProvider>
  );

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
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('calls onGhostFound and shows a localized light hint when server returns 410', async () => {
    const onGhostFound = vi.fn<(path: string) => void>();
    const fetchMock = vi.fn(async () => {
      return { ok: false, status: 410 } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const h = renderHookHarness(onGhostFound, 'zh-CN');
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
    expect(h.getLatest().toast?.msg).toBe('文件已被移动或删除，已从结果中移除');
  });

  it('keeps existing behavior on success (starts download + success toast)', async () => {
    const onGhostFound = vi.fn<(path: string) => void>();

    const blob = new Blob(['hello'], { type: 'text/plain' });
    const fetchMock = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        blob: async () => blob,
      } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const createObjectURL = vi.fn(() => 'blob:mock');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', {
      createObjectURL,
      revokeObjectURL,
    } as unknown as typeof URL);

    const click = vi.fn();
    const appendChild = vi.spyOn(document.body, 'appendChild');
    const removeChild = vi.spyOn(document.body, 'removeChild');

    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      const el = origCreateElement(tagName);
      if (tagName === 'a') {
        Object.defineProperty(el, 'click', { value: click });
      }
      return el;
    });

    const h = renderHookHarness(onGhostFound, 'en');
    await h.flush();

    const item: SearchHit = { path: '/tmp/ok.txt', score: 1 };
    await act(async () => {
      await h.getLatest().handleDownload(item);
    });
    await h.flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onGhostFound).not.toHaveBeenCalled();
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(appendChild).toHaveBeenCalled();
    expect(removeChild).toHaveBeenCalled();

    expect(h.getLatest().toast?.type).toBe('success');
    expect(h.getLatest().toast?.msg).toBe('Started download: ok.txt');
  });

  it('shows an English error toast for non-410 failures', async () => {
    const onGhostFound = vi.fn<(path: string) => void>();
    const fetchMock = vi.fn(async () => {
      return { ok: false, status: 500 } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const h = renderHookHarness(onGhostFound, 'en');
    await h.flush();

    const item: SearchHit = { path: '/tmp/fail.txt', score: 1 };
    await act(async () => {
      await h.getLatest().handleDownload(item);
    });
    await h.flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onGhostFound).not.toHaveBeenCalled();
    expect(h.getLatest().toast?.type).toBe('error');
    expect(h.getLatest().toast?.msg).toBe('Download failed');
    consoleError.mockRestore();
  });

  it('only issues one request for rapid repeated triggers', async () => {
    const onGhostFound = vi.fn<(path: string) => void>();

    let resolveFetch: ((v: Response) => void) | null = null;
    const fetchStarted = vi.fn();
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          fetchStarted();
          resolveFetch = resolve;
        })
    );
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const createObjectURL = vi.fn(() => 'blob:mock');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', {
      createObjectURL,
      revokeObjectURL,
    } as unknown as typeof URL);

    const click = vi.fn();
    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      const el = origCreateElement(tagName);
      if (tagName === 'a') {
        Object.defineProperty(el, 'click', { value: click });
      }
      return el;
    });

    const h = renderHookHarness(onGhostFound);
    await h.flush();

    const item: SearchHit = { path: '/tmp/slow.txt', score: 1 };
    const p1 = h.getLatest().handleDownload(item);
    const p2 = h.getLatest().handleDownload(item);

    expect(fetchStarted).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch?.(
      ({
        ok: true,
        status: 200,
        blob: async () => new Blob(['x']),
      } as unknown as Response)
    );

    await act(async () => {
      await Promise.all([p1, p2]);
    });
    await h.flush();

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });

  it('does not update state or fire delayed toast cleanup after unmount', async () => {
    const onGhostFound = vi.fn<(path: string) => void>();
    const fetchMock = vi.fn(async () => {
      return { ok: false, status: 410 } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const h = renderHookHarness(onGhostFound);
    await h.flush();

    const item: SearchHit = { path: '/tmp/ghost-late.txt', score: 1 };
    // Trigger a toast + timeout, then immediately unmount before timers run.
    const p = h.getLatest().handleDownload(item);
    h.unmount();

    await act(async () => {
      await p;
    });

    act(() => {
      vi.runAllTimers();
    });

    // React warns via console.error on setState after unmount.
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
