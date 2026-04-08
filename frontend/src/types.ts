export interface SearchHit {
  path: string;
  score: number;
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

export type WSMessage = SearchResponse | IndexRefreshedBroadcast;

export type AppStatus = 'ready' | 'refreshing' | 'disconnected';
