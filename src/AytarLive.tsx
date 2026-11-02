import { useCallback, useEffect, useRef, useState } from 'react';
import { Video, VideoOff, Eye, EyeOff, X, LoaderCircle, Radio } from 'lucide-react';
import { isLiveConfigured, liveSupabase, ICE_SERVERS } from './lib/liveClient';
import type { LiveSession, LiveSignal } from './lib/liveTypes';

type Profile = {
  id: string;
  status: 'pending' | 'active' | 'disabled';
  role: 'user' | 'admin';
  username: string | null;
};

type Pin = {
  id: string;
  lat: number;
  lng: number;
  description: string;
};

type Session = { user?: { id: string } } | null;

interface AytarLiveProps {
  selectedPin: Pin | null;
  profile: Profile | null;
  session: Session;
  onNotice: (notice: { kind: 'success' | 'error' | 'info'; text: string }) => void;
  onAuthRequired: () => void;
}

type ComponentState =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'broadcasting'; sessionId: string }
  | { kind: 'watching'; sessionId: string }
  | { kind: 'error'; message: string };

/** Pin koordinatına ±500m rastgele jitter uygular (konum gizliliği). */
function jitterCoords(lat: number, lng: number): { lat: number; lng: number } {
  const meters = 500;
  const latDelta = (Math.random() * 2 - 1) * (meters / 111320);
  const lngDelta =
    (Math.random() * 2 - 1) * (meters / (111320 * Math.cos((lat * Math.PI) / 180)));
  return { lat: lat + latDelta, lng: lng + lngDelta };
}

export default function AytarLive({
  selectedPin,
  profile,
  session,
  onNotice,
  onAuthRequired,
}: AytarLiveProps) {
  const [state, setState] = useState<ComponentState>({ kind: 'idle' });
  const [activeSessions, setActiveSessions] = useState<LiveSession[]>([]);
  const [showViewerList, setShowViewerList] = useState(false);

  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const signalChannelRef = useRef<ReturnType<NonNullable<typeof liveSupabase>['channel']> | null>(null);

  const isActive = profile?.status === 'active';
  const isSignedIn = Boolean(session?.user?.id);
  const configured = isLiveConfigured && Boolean(liveSupabase);

  // Aktif yayınları dinle
  useEffect(() => {
    if (!liveSupabase) return;
    const channel = liveSupabase
      .channel('live-sessions-watch')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'live_sessions' },
        (payload) => {
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const row = payload.new as LiveSession;
            setActiveSessions((current) => {
              const filtered = current.filter((s) => s.id !== row.id);
              if (row.status === 'live') return [...filtered, row];
              return filtered;
            });
          } else if (payload.eventType === 'DELETE') {
            const row = payload.old as { id: string };
            setActiveSessions((current) => current.filter((s) => s.id !== row.id));
          }
        }
      )
      .subscribe();

    // İlk yüklemede mevcut yayınları al
    void liveSupabase
      .from('live_sessions')
      .select('*')
      .eq('status', 'live')
      .then(({ data }) => {
        if (data) setActiveSessions(data as LiveSession[]);
      });

    return () => {
      void liveSupabase.removeChannel(channel);
    };
  }, []);

  const cleanupBroadcast = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    if (signalChannelRef.current) {
      void liveSupabase?.removeChannel(signalChannelRef.current);
      signalChannelRef.current = null;
    }
  }, []);

  const endBroadcast = useCallback(
    async (sessionId: string) => {
      cleanupBroadcast();
      if (liveSupabase) {
        await liveSupabase
          .from('live_sessions')
          .update({ status: 'ended', ended_at: new Date().toISOString() })
          .eq('id', sessionId);
      }
      setState({ kind: 'idle' });
    },
    [cleanupBroadcast]
  );

  const startBroadcast = useCallback(async () => {
    if (!configured || !liveSupabase) {
      onNotice({ kind: 'error', text: 'Canlı yayın yapılandırması eksik (LAB anahtarları).' });
      return;
    }
    if (!isSignedIn) {
      onAuthRequired();
      return;
    }
    if (!isActive) {
      onNotice({ kind: 'info', text: 'Canlı yayın açmak için hesabını etkinleştirmelisin.' });
      return;
    }
    if (!selectedPin) {
      onNotice({ kind: 'info', text: 'Yayın açmak için önce bir pin seçmelisin.' });
      return;
    }

    setState({ kind: 'starting' });

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'environment' },
        audio: true,
      });
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      const jittered = jitterCoords(selectedPin.lat, selectedPin.lng);

      // DB'de max 10 limit ve race condition allocate_live_session_slot trigger'ında çözülür.
      const { data, error } = await liveSupabase
        .from('live_sessions')
        .insert({
          broadcaster_id: session!.user!.id,
          pin_id: selectedPin.id,
          lat: jittered.lat,
          lng: jittered.lng,
          status: 'live',
          title: selectedPin.description.slice(0, 120),
        })
        .select('id')
        .single();

      if (error || !data) {
        throw new Error(error?.message || 'Yayın oturumu oluşturulamadı.');
      }

      setState({ kind: 'broadcasting', sessionId: data.id });
      onNotice({ kind: 'success', text: 'Canlı yayın başladı.' });
    } catch (err) {
      cleanupBroadcast();
      const message = err instanceof Error ? err.message : 'Kamera erişimi reddedildi.';
      setState({ kind: 'error', message });
      onNotice({ kind: 'error', text: message });
    }
  }, [configured, isSignedIn, isActive, selectedPin, session, onNotice, onAuthRequired, cleanupBroadcast]);

  const watchSession = useCallback(
    async (target: LiveSession) => {
      if (!liveSupabase) return;
      setState({ kind: 'starting' });
      try {
        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        peerConnectionRef.current = pc;
        const remoteStream = new MediaStream();
        pc.ontrack = (event) => {
          event.streams[0]?.getTracks().forEach((t) => remoteStream.addTrack(t));
          if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
        };
        const channel = liveSupabase
          .channel(`live-signals-${target.id}`)
          .on(
            'postgres_changes',
            {
              event: 'INSERT',
              schema: 'public',
              table: 'live_signals',
              filter: `session_id=eq.${target.id}`,
            },
            async (payload) => {
              const sig = payload.new as LiveSignal;
              if (sig.to_peer !== session?.user?.id) return;
              try {
                if (sig.type === 'offer') {
                  await pc.setRemoteDescription(new RTCSessionDescription(sig.payload as RTCSessionDescriptionInit));
                  const answer = await pc.createAnswer();
                  await pc.setLocalDescription(answer);
                  await liveSupabase.from('live_signals').insert({
                    session_id: target.id,
                    from_peer: session!.user!.id,
                    to_peer: target.broadcaster_id,
                    type: 'answer',
                    payload: answer as unknown as Record<string, unknown>,
                  });
                } else if (sig.type === 'ice') {
                  await pc.addIceCandidate(new RTCIceCandidate(sig.payload as RTCIceCandidateInit));
                }
              } catch (err) {
                console.warn('Signal işleme hatası:', err);
              }
            }
          )
          .subscribe();
        signalChannelRef.current = channel;
        setState({ kind: 'watching', sessionId: target.id });
        setShowViewerList(false);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Yayına bağlanılamadı.';
        setState({ kind: 'error', message });
        onNotice({ kind: 'error', text: message });
      }
    },
    [session, onNotice]
  );

  const closePlayer = useCallback(() => {
    cleanupBroadcast();
    setState({ kind: 'idle' });
  }, [cleanupBroadcast]);

  // Bileşen unmount olunca temizlik
  useEffect(() => () => cleanupBroadcast(), [cleanupBroadcast]);

  const isBusy = state.kind === 'starting';
  const broadcasting = state.kind === 'broadcasting';
  const watching = state.kind === 'watching';

  // Buton etiketi ve tooltip
  const buttonTitle = broadcasting
    ? 'Yayını bitir'
    : watching
      ? 'İzlemeyi kapat'
      : isSignedIn && isActive && selectedPin
        ? 'Canlı yayın aç'
        : activeSessions.length > 0
          ? `${activeSessions.length} canlı yayın izle`
          : isSignedIn
            ? 'Yayın açmak için pin seç'
            : 'Canlı yayın (giriş gerekli)';

  return (
    <>
      <button
        type="button"
        className={`aytar-live-button ${broadcasting || watching ? 'is-active' : ''} ${isBusy ? 'is-busy' : ''}`}
        onClick={() => {
          if (broadcasting) {
            void endBroadcast(state.sessionId);
          } else if (watching) {
            closePlayer();
          } else if (activeSessions.length > 0 && !selectedPin) {
            setShowViewerList(true);
          } else if (selectedPin) {
            void startBroadcast();
          } else {
            setShowViewerList(true);
          }
        }}
        disabled={isBusy}
        title={buttonTitle}
        aria-label={buttonTitle}
      >
        {isBusy ? (
          <LoaderCircle size={16} className="gps-spinner" />
        ) : broadcasting ? (
          <VideoOff size={16} />
        ) : watching ? (
          <EyeOff size={16} />
        ) : activeSessions.length > 0 ? (
          <><Radio size={16} /><span className="aytar-live-count">{activeSessions.length}</span></>
        ) : (
          <Video size={16} />
        )}
      </button>

      {/* Yayıncı: yerel kamera önizlemesi */}
      {broadcasting && (
        <div className="aytar-live-overlay" role="dialog" aria-label="Canlı yayın">
          <div className="aytar-live-header">
            <span className="aytar-live-live-dot" />
            <strong>CANLI</strong>
            <button
              type="button"
              onClick={() => void endBroadcast(state.sessionId)}
              aria-label="Yayını bitir"
            >
              <X size={18} />
            </button>
          </div>
          <video ref={localVideoRef} autoPlay muted playsInline className="aytar-live-video" />
        </div>
      )}

      {/* İzleyici: uzak yayın */}
      {watching && (
        <div className="aytar-live-overlay" role="dialog" aria-label="Canlı yayını izle">
          <div className="aytar-live-header">
            <span className="aytar-live-live-dot" />
            <strong>İZLİYORSUN</strong>
            <button type="button" onClick={closePlayer} aria-label="İzlemeyi kapat">
              <X size={18} />
            </button>
          </div>
          <video ref={remoteVideoRef} autoPlay playsInline className="aytar-live-video" />
        </div>
      )}

      {/* Aktif yayın listesi */}
      {showViewerList && !broadcasting && !watching && (
        <div className="aytar-live-viewer-list" role="dialog" aria-label="Aktif yayınlar">
          <div className="aytar-live-header">
            <Radio size={18} />
            <strong>Aktif Yayınlar ({activeSessions.length})</strong>
            <button type="button" onClick={() => setShowViewerList(false)} aria-label="Kapat">
              <X size={18} />
            </button>
          </div>
          {activeSessions.length === 0 ? (
            <p className="aytar-live-empty">Şu an aktif yayın yok.</p>
          ) : (
            <ul className="aytar-live-session-list">
              {activeSessions.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => void watchSession(s)}
                    className="aytar-live-session-item"
                  >
                    <Eye size={16} />
                    <span>{s.title || 'Canlı yayın'}</span>
                    <small>{s.viewer_count} izleyici</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}
