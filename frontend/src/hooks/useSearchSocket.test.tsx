import React, { useEffect } from 'react';
import { render, act } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { useSearchSocket } from './useSearchSocket';
import { I18nProvider } from '../i18n/I18nProvider';

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  url: string;
  readyState = MockWebSocket.CONNECTING;

  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  send = vi.fn<(data: string) => void>();
  close = vi.fn<() => void>(() => {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(new CloseEvent('close'));
  });

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.(new Event('open'));
  }

  error() {
    this.onerror?.(new Event('error'));
  }

  receive(data: unknown) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }));
  }
}

function renderHookHarness() {
  let latest: ReturnType<typeof useSearchSocket> | null = null;

  function Harness(props: { onUpdate: (s: ReturnType<typeof useSearchSocket>) => void }) {
    const state = useSearchSocket();
    useEffect(() => {
      props.onUpdate(state);
    });
    return null;
  }

  const rendered = render(
    <I18nProvider initialLocale="en">
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

describe('useSearchSocket', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('micro-debounces and only sends the last query', async () => {
    const h = renderHookHarness();

    await h.flush();
    expect(MockWebSocket.instances.length).toBe(1);
    const ws = MockWebSocket.instances[0]!;
    act(() => ws.open());

    act(() => {
      h.getLatest().setQuery('a');
      h.getLatest().setQuery('ab');
      h.getLatest().setQuery('abc');
    });
    await h.flush();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    await h.flush();

    expect(ws.send).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(ws.send.mock.calls[0]![0]);
    expect(sent.query).toBe('abc');
  });

  it('only accepts results for the latest req_id', async () => {
    const h = renderHookHarness();

    await h.flush();
    expect(MockWebSocket.instances.length).toBe(1);
    const ws = MockWebSocket.instances[0]!;
    act(() => ws.open());

    act(() => h.getLatest().setQuery('one'));
    await h.flush();
    act(() => vi.advanceTimersByTime(1000));
    await h.flush();
    expect(ws.send).toHaveBeenCalledTimes(1);
    const req1 = JSON.parse(ws.send.mock.calls[0]![0]).req_id as number;

    act(() => h.getLatest().setQuery('two'));
    await h.flush();
    act(() => vi.advanceTimersByTime(1000));
    await h.flush();
    expect(ws.send).toHaveBeenCalledTimes(2);
    const req2 = JSON.parse(ws.send.mock.calls[1]![0]).req_id as number;

    expect(req2).toBeGreaterThan(req1);

    const data2 = [{ path: 'b.txt', score: 2 }];
    const data1 = [{ path: 'a.txt', score: 1 }];

    act(() => ws.receive({ req_id: req2, data: data2 }));
    await h.flush();
    expect(h.getLatest().results).toEqual(data2);

    act(() => ws.receive({ req_id: req1, data: data1 }));
    // stale response must not override latest results
    await h.flush();
    expect(h.getLatest().results).toEqual(data2);
  });

  it('re-queries current query when receiving INDEX_REFRESHED', async () => {
    const h = renderHookHarness();

    await h.flush();
    expect(MockWebSocket.instances.length).toBe(1);
    const ws = MockWebSocket.instances[0]!;
    act(() => ws.open());

    act(() => h.getLatest().setQuery('hello'));
    await h.flush();
    act(() => vi.advanceTimersByTime(1000));
    await h.flush();
    expect(ws.send).toHaveBeenCalledTimes(1);
    const req1 = JSON.parse(ws.send.mock.calls[0]![0]).req_id as number;

    act(() => ws.receive({ type: 'INDEX_REFRESHED' }));
    await h.flush();
    expect(ws.send).toHaveBeenCalledTimes(2);
    const sent2 = JSON.parse(ws.send.mock.calls[1]![0]);

    expect(sent2.query).toBe('hello');
    expect(sent2.req_id).toBeGreaterThan(req1);
    expect(h.getLatest().refreshToast).toEqual({
      msg: 'Search results updated',
      type: 'success',
    });
  });

  it('clears refresh toast after a delay', async () => {
    const h = renderHookHarness();

    await h.flush();
    const ws = MockWebSocket.instances[0]!;
    act(() => ws.open());

    act(() => h.getLatest().setQuery('hello'));
    await h.flush();
    act(() => vi.advanceTimersByTime(1000));
    await h.flush();

    act(() => ws.receive({ type: 'INDEX_REFRESHED' }));
    await h.flush();
    expect(h.getLatest().refreshToast).toEqual({
      msg: 'Search results updated',
      type: 'success',
    });

    act(() => vi.advanceTimersByTime(3000));
    await h.flush();
    expect(h.getLatest().refreshToast).toBeNull();
  });

  it('tracks backend index status pushed over websocket', async () => {
    const h = renderHookHarness();

    await h.flush();
    const ws = MockWebSocket.instances[0]!;
    act(() => ws.open());
    await h.flush();

    act(() => ws.receive({ type: 'INDEX_STATUS', state: 'pending' }));
    await h.flush();
    expect(h.getLatest().indexStatus).toBe('pending');

    act(() => ws.receive({ type: 'INDEX_STATUS', state: 'refreshing' }));
    await h.flush();
    expect(h.getLatest().indexStatus).toBe('refreshing');

    act(() => ws.receive({ type: 'INDEX_STATUS', state: 'ready' }));
    await h.flush();
    expect(h.getLatest().indexStatus).toBe('ready');
  });

  it('reflects connectionStatus changes and reconnects after close', async () => {
    const h = renderHookHarness();

    await h.flush();
    expect(MockWebSocket.instances.length).toBe(1);
    const ws1 = MockWebSocket.instances[0]!;

    // relative host + protocol (jsdom defaults to http://localhost/)
    const expectedWsUrl =
      `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;
    expect(ws1.url).toBe(expectedWsUrl);

    await h.flush();
    expect(h.getLatest().connectionStatus).toBe('connecting');

    act(() => ws1.open());
    await h.flush();
    expect(h.getLatest().connectionStatus).toBe('ready');

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    act(() => ws1.error());
    await h.flush();
    expect(h.getLatest().connectionStatus).toBe('error');
    consoleError.mockRestore();

    act(() => ws1.close());
    await h.flush();
    expect(h.getLatest().connectionStatus).toBe('disconnected');

    act(() => vi.advanceTimersByTime(5000));
    await h.flush();
    expect(MockWebSocket.instances.length).toBeGreaterThan(1);

    const ws2 = MockWebSocket.instances[1]!;
    act(() => ws2.open());
    await h.flush();
    expect(h.getLatest().connectionStatus).toBe('ready');
  });

  it('buffers query while socket is not open and sends on open', async () => {
    const h = renderHookHarness();

    await h.flush();
    expect(MockWebSocket.instances.length).toBe(1);
    const ws = MockWebSocket.instances[0]!;

    act(() => h.getLatest().setQuery('buffered'));
    await h.flush();
    act(() => vi.advanceTimersByTime(1000));
    await h.flush();

    expect(ws.send).toHaveBeenCalledTimes(0);

    act(() => ws.open());
    await h.flush();
    expect(ws.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(ws.send.mock.calls[0]![0]).query).toBe('buffered');
  });

  it('after reconnect, re-sends current query on new connection open', async () => {
    const h = renderHookHarness();

    await h.flush();
    const ws1 = MockWebSocket.instances[0]!;
    act(() => ws1.open());
    await h.flush();

    act(() => h.getLatest().setQuery('stay'));
    await h.flush();
    act(() => vi.advanceTimersByTime(1000));
    await h.flush();
    expect(ws1.send).toHaveBeenCalledTimes(1);

    act(() => ws1.close());
    await h.flush();

    act(() => vi.advanceTimersByTime(5000));
    await h.flush();
    expect(MockWebSocket.instances.length).toBeGreaterThan(1);

    const ws2 = MockWebSocket.instances[1]!;
    act(() => ws2.open());
    await h.flush();

    expect(ws2.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(ws2.send.mock.calls[0]![0]).query).toBe('stay');
  });

  it('cleanup close does not schedule reconnect', async () => {
    const h = renderHookHarness();

    await h.flush();
    expect(MockWebSocket.instances.length).toBe(1);

    h.unmount();

    act(() => vi.advanceTimersByTime(10000));
    await act(async () => {
      await Promise.resolve();
    });

    expect(MockWebSocket.instances.length).toBe(1);
  });

  it('clearing query clears pending offline buffer; open does not send stale query', async () => {
    const h = renderHookHarness();

    await h.flush();
    expect(MockWebSocket.instances.length).toBe(1);
    const ws = MockWebSocket.instances[0]!;

    // Type while disconnected; let debounce elapse so sendSearch would buffer.
    act(() => h.getLatest().setQuery('stale'));
    await h.flush();
    act(() => vi.advanceTimersByTime(1000));
    await h.flush();
    expect(ws.send).toHaveBeenCalledTimes(0);

    // User clears input before connection opens.
    act(() => h.getLatest().setQuery(''));
    await h.flush();

    act(() => ws.open());
    await h.flush();

    expect(ws.send).toHaveBeenCalledTimes(0);
  });

  it('does not double-send when socket opens during debounce window', async () => {
    const h = renderHookHarness();

    await h.flush();
    const ws = MockWebSocket.instances[0]!;

    act(() => h.getLatest().setQuery('dup'));
    await h.flush();

    // Open the socket before debounce fires.
    act(() => ws.open());
    await h.flush();

    // Still within debounce window: should not have sent yet.
    expect(ws.send).toHaveBeenCalledTimes(0);

    act(() => vi.advanceTimersByTime(1000));
    await h.flush();

    expect(ws.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(ws.send.mock.calls[0]![0]).query).toBe('dup');
  });

  it('clears stale pending after a successful send; reconnect uses only current query', async () => {
    const h = renderHookHarness();

    await h.flush();
    expect(MockWebSocket.instances.length).toBe(1);
    const ws1 = MockWebSocket.instances[0]!;

    // 1) Create an "old" pending while disconnected.
    act(() => h.getLatest().setQuery('old'));
    await h.flush();
    act(() => vi.advanceTimersByTime(1000)); // let debounce elapse and buffer pending
    await h.flush();
    expect(ws1.send).toHaveBeenCalledTimes(0);

    // 2) User changes to a new query, but socket opens during debounce window.
    act(() => h.getLatest().setQuery('new'));
    await h.flush();
    act(() => ws1.open());
    await h.flush();

    // Should not send immediately because debounce for the current query is pending.
    expect(ws1.send).toHaveBeenCalledTimes(0);

    // Debounce fires: successfully sends "new" (this must invalidate any older pending).
    act(() => vi.advanceTimersByTime(1000));
    await h.flush();
    expect(ws1.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(ws1.send.mock.calls[0]![0]).query).toBe('new');

    // 3) Disconnect and reconnect.
    act(() => ws1.close());
    await h.flush();
    act(() => vi.advanceTimersByTime(5000));
    await h.flush();
    expect(MockWebSocket.instances.length).toBeGreaterThan(1);

    const ws2 = MockWebSocket.instances[1]!;
    act(() => ws2.open());
    await h.flush();

    // Must not replay "old" pending; only current query "new" is allowed.
    expect(ws2.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(ws2.send.mock.calls[0]![0]).query).toBe('new');
  });
});
