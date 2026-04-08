import { useState, useEffect, useRef, useCallback } from 'react';
import { SearchHit, WSMessage, SearchRequest, AppStatus } from '../types';

const WS_URL = `ws://${window.location.hostname}:3000/ws`;
const DEBOUNCE_MS = 100;

export function useSearchSocket() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchHit[]>([]);
  const [status, setStatus] = useState<AppStatus>('disconnected');
  const [isSearching, setIsSearching] = useState(false);
  
  const wsRef = useRef<WebSocket | null>(null);
  const reqIdRef = useRef(0);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Send search query to backend
  const sendSearch = useCallback((q: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    
    const req_id = ++reqIdRef.current;
    const request: SearchRequest = { req_id, query: q };
    
    wsRef.current.send(JSON.stringify(request));
    setIsSearching(true);
  }, []);

  // Handle incoming messages
  const onMessage = useCallback((event: MessageEvent) => {
    try {
      const msg: WSMessage = JSON.parse(event.data);

      if ('type' in msg && msg.type === 'INDEX_REFRESHED') {
        // Silent re-query on index refresh
        setStatus('ready');
        if (query) sendSearch(query);
      } else if ('req_id' in msg) {
        // Only update if this is the latest request
        if (msg.req_id === reqIdRef.current) {
          setResults(msg.data);
          setIsSearching(false);
        }
      }
    } catch (err) {
      console.error('Failed to parse WS message:', err);
    }
  }, [query, sendSearch]);

  // Manage WS connection
  useEffect(() => {
    const connect = () => {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => setStatus('ready');
      ws.onmessage = onMessage;
      ws.onclose = () => {
        setStatus('disconnected');
        // Simple reconnect logic
        setTimeout(connect, 3000);
      };
      ws.onerror = (err) => console.error('WS error:', err);
    };

    connect();
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [onMessage]);

  // Debounced query effect
  useEffect(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    
    if (!query) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    debounceTimerRef.current = setTimeout(() => {
      sendSearch(query);
    }, DEBOUNCE_MS);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [query, sendSearch]);

  const triggerForceRefresh = () => {
    // In a real app, this might be a separate API call or a specific WS message
    // For now, we follow the spec: the backend broadcasts INDEX_REFRESHED when it finishes scanning.
    // If we want to "trigger" it, we might need a REST endpoint.
    // Let's assume there's a POST /refresh or similar if needed, 
    // but the backend design says it's triggered by "usage" or TTL.
    setStatus('refreshing');
  };

  return {
    query,
    setQuery,
    results,
    setResults,
    status,
    isSearching,
    triggerForceRefresh
  };
}
