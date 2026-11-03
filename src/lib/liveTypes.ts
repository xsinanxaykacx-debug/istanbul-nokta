// AYTAR LIVE — LAB veritabanı tipleri
export type LiveSessionStatus = 'starting' | 'live' | 'ended' | 'stale';

export interface LiveSession {
  id: string;
  broadcaster_id: string;
  pin_id: string | null;
  lat: number;
  lng: number;
  status: LiveSessionStatus;
  started_at: string;
  ended_at: string | null;
  viewer_count: number;
  title: string | null;
}

export type LiveSignalType = 'join' | 'offer' | 'answer' | 'ice';

export interface LiveSignal {
  id: string;
  session_id: string;
  from_peer: string;
  to_peer: string;
  type: LiveSignalType;
  payload: Record<string, unknown>;
  created_at: string;
}
