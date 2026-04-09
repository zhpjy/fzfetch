export interface SearchHit {
  path: string;
  score: number;
  size_bytes?: number | null;
}

export interface SearchRequest {
  req_id: number;
  query: string;
}

export interface SearchResponse {
  req_id: number;
  data: SearchHit[];
}

export interface IndexRefreshedBroadcast {
  type: "INDEX_REFRESHED";
}

export interface IndexStatusMessage {
  type: "INDEX_STATUS";
  state: IndexStatus;
}

export type WSMessage = SearchResponse | IndexRefreshedBroadcast | IndexStatusMessage;

export type AppStatus = 'ready' | 'refreshing' | 'disconnected';

export type ConnectionStatus = 'connecting' | 'ready' | 'disconnected' | 'error';

export type IndexStatus = 'unknown' | 'pending' | 'refreshing' | 'ready';

export type WorkStatus = 'idle' | 'searching' | 'refreshing';
