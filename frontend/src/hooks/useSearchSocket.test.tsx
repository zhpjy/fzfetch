import React, { useEffect } from 'react';
import { render, act } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { useSearchSocket } from './useSearchSocket';

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

  render(<Harness onUpdate={(s) => (latest = s)} />);

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
});
