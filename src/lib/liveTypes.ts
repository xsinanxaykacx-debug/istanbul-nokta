// AYTAR LIVE — LAB veritabanı tipleri
// Bu tipler sadece live_sessions ve live_signals tabloları içindir.
// AYTAR ana verisi (pins, profiles) bu dosyada YOKTUR.

export type LiveSessionStatus = 'starting' | 'live' | 'ended' | 'stale';

export interface LiveSession {
  id: string;
  broadcaster_id: string;
  pin_id: string | null;
  /** Pin koordinatına ±500m jitter uygulanmış yaklaşık konum */
  lat: number;
  lng: number;
  status: LiveSessionStatus;
  started_at: string;
  ended_at: string | null;
  viewer_count: number;
  title: string | null;
}

export type LiveSignalType = 'offer' | 'answer' | 'ice';

export interface LiveSignal {
  id: string;
  session_id: string;
  from_peer: string;
  to_peer: string;
  type: LiveSignalType;
  payload: Record<string, unknown>;
  created_at: string;
}

export type LiveViewState =
  | { kind: 'idle' }
  | { kind: 'requesting-camera' }
  | { kind: 'starting-session' }
  | { kind: 'broadcasting'; sessionId: string; stream: MediaStream }
  | { kind: 'viewing'; sessionId: string; stream: MediaStream }
  | { kind: 'error'; message: string };
