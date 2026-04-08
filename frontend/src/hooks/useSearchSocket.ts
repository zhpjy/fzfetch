import { useState, useEffect, useRef, useCallback } from 'react';
import { ConnectionStatus, SearchHit, SearchRequest, WorkStatus } from '../types';

const DEBOUNCE_MS = 100;
const RECONNECT_MS = 1000;

function buildWsUrl() {
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProtocol}//${window.location.host}/ws`;
}

export function useSearchSocket() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchHit[]>([]);

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [workStatus, setWorkStatus] = useState<WorkStatus>('idle');
  const isSearching = workStatus !== 'idle';

  const wsRef = useRef<WebSocket | null>(null);
  const latestReqIdRef = useRef(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queryRef = useRef('');
  queryRef.current = query;

  const sendSearch = useCallback((q: string, nextWorkStatus: WorkStatus) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const req_id = ++latestReqIdRef.current;
    const request: SearchRequest = { req_id, query: q };
    ws.send(JSON.stringify(request));
    setWorkStatus(nextWorkStatus);
  }, []);

  const onMessage = useCallback((event: MessageEvent) => {
    try {
      const msg = JSON.parse(event.data) as unknown;

      if (
        typeof msg === 'object' &&
        msg !== null &&
        'type' in msg &&
        (msg as { type?: unknown }).type === 'INDEX_REFRESHED'
      ) {
        const current = queryRef.current.trim();
        if (current) sendSearch(current, 'refreshing');
        return;
      }

      if (typeof msg === 'object' && msg !== null && 'req_id' in msg) {
        const req_id = (msg as { req_id?: unknown }).req_id;
        if (typeof req_id === 'number' && req_id === latestReqIdRef.current) {
          const data = (msg as { data?: unknown }).data;
          if (Array.isArray(data)) {
            setResults(data as SearchHit[]);
            setWorkStatus('idle');
          }
        }
      }
    } catch (err) {
      console.error('Failed to parse WS message:', err);
    }
  }, [sendSearch]);

  useEffect(() => {
    let closedByCleanup = false;

    const connect = () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }

      setConnectionStatus('connecting');

      const ws = new WebSocket(buildWsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        setConnectionStatus('ready');
      };
      ws.onmessage = onMessage;
      ws.onclose = () => {
        setConnectionStatus('disconnected');
        if (closedByCleanup) return;
        reconnectTimerRef.current = setTimeout(connect, RECONNECT_MS);
      };
      ws.onerror = (err) => {
        console.error('WS error:', err);
        setConnectionStatus('error');
      };
    };

    connect();
    return () => {
      closedByCleanup = true;

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [onMessage]);

  useEffect(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    
    const next = query.trim();
    if (!next) {
      setResults([]);
      setWorkStatus('idle');
      return;
    }

    debounceTimerRef.current = setTimeout(() => {
      sendSearch(next, 'searching');
    }, DEBOUNCE_MS);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [query, sendSearch]);

  return {
    query,
    setQuery,
    results,
    setResults,
    connectionStatus,
    workStatus,
    isSearching,
  };
}
