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

function jitterCoords(lat: number, lng: number): { lat: number; lng: number } {
  const meters = 500;
  const latDelta = (Math.random() * 2 - 1) * (meters / 111320);
  const lngDelta = (Math.random() * 2 - 1) * (meters / (111320 * Math.cos((lat * Math.PI) / 180)));
  return { lat: lat + latDelta, lng: lng + lngDelta };
}

type BroadcasterPeer = { 
  pc: RTCPeerConnection; 
  pendingIce: RTCIceCandidateInit[]; 
};

export default function AytarLive({ selectedPin, profile, session, onNotice, onAuthRequired }: AytarLiveProps) {
  const [state, setState] = useState<ComponentState>({ kind: 'idle' });
  const [activeSessions, setActiveSessions] = useState<LiveSession[]>([]);
  const [showViewerList, setShowViewerList] = useState(false);

  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const broadcasterPeersRef = useRef<Map<string, BroadcasterPeer>>(new Map());
  const viewerPeerRef = useRef<RTCPeerConnection | null>(null);
  const signalChannelRef = useRef<any>(null);

  const isActive = profile?.status === 'active';
  const isSignedIn = Boolean(session?.user?.id);
  const configured = isLiveConfigured && Boolean(liveSupabase);

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
              return row.status === 'live' ? [...filtered, row] : filtered;
            });
          } else if (payload.eventType === 'DELETE') {
            const row = payload.old as { id: string };
            setActiveSessions((current) => current.filter((s) => s.id !== row.id));
          }
        }
      )
      .subscribe();

    const supa = liveSupabase!;
    void supa.from('live_sessions')
      .select('*')
      .eq('status', 'live')
      .then(({ data }) => {
        if (data) setActiveSessions(data as LiveSession[]);
      });

    return () => {
      const supa = liveSupabase;
      if (supa) void supa.removeChannel(channel);
    };
  }, []);

  const cleanupAll = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    broadcasterPeersRef.current.forEach(({ pc }) => pc.close());
    broadcasterPeersRef.current.clear();

    if (viewerPeerRef.current) {
      viewerPeerRef.current.close();
      viewerPeerRef.current = null;
    }
    if (signalChannelRef.current && liveSupabase) {
      void liveSupabase.removeChannel(signalChannelRef.current);
      signalChannelRef.current = null;
    }
  }, []);

  const createOfferForViewer = useCallback(
    async (sessionId: string, broadcasterId: string, viewerId: string) => {
      if (!liveSupabase || !localStreamRef.current) return;
      const existing = broadcasterPeersRef.current.get(viewerId);
      if (existing) {
        existing.pc.close();
        broadcasterPeersRef.current.delete(viewerId);
      }

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      const peer: BroadcasterPeer = { pc, pendingIce: [] };
      broadcasterPeersRef.current.set(viewerId, peer);

      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current!);
      });

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          void liveSupabase!.from('live_signals').insert({
            session_id: sessionId,
            from_peer: broadcasterId,
            to_peer: viewerId,
            type: 'ice',
            payload: event.candidate.toJSON(),
          });
        }
      };

      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await liveSupabase.from('live_signals').insert({
          session_id: sessionId,
          from_peer: broadcasterId,
          to_peer: viewerId,
          type: 'offer',
          payload: offer,
        });
      } catch (err) {
        console.warn('Offer error:', err);
        pc.close();
        broadcasterPeersRef.current.delete(viewerId);
      }
    },
    []
  );

  const startBroadcast = useCallback(async () => {
    if (!configured || !liveSupabase) {
      onNotice({ kind: 'error', text: 'LAB ayarları eksik.' });
      return;
    }
    if (!isSignedIn) {
      onAuthRequired();
      return;
    }
    if (!isActive) {
      onNotice({ kind: 'info', text: 'Hesabını etkinleştirmelisin.' });
      return;
    }
    if (!selectedPin) {
      onNotice({ kind: 'info', text: 'Önce bir pin seçmelisin.' });
      return;
    }

    setState({ kind: 'starting' });

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'environment' },
        audio: true,
      });
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;

      const jittered = jitterCoords(selectedPin.lat, selectedPin.lng);

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

      if (error || !data) throw new Error(error?.message || 'Yayın başlatılamadı.');

      const sessionId = data.id;
      const broadcasterId = session!.user!.id;

      const channel = liveSupabase
        .channel(`broadcaster-signals-${sessionId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'live_signals',
            filter: `session_id=eq.${sessionId}`,
          },
          async (payload) => {
            const sig = payload.new as LiveSignal;
            if (sig.to_peer !== broadcasterId) return;

            if (sig.type === 'join') {
              await createOfferForViewer(sessionId, broadcasterId, sig.from_peer);
            } else if (sig.type === 'answer') {
              const peer = broadcasterPeersRef.current.get(sig.from_peer);
              if (peer) {
                try {
                  await peer.pc.setRemoteDescription(
                    new RTCSessionDescription(sig.payload as unknown as RTCSessionDescriptionInit)
                  );
                  for (const ice of peer.pendingIce) {
                    await peer.pc.addIceCandidate(new RTCIceCandidate(ice)).catch(() => {});
                  }
                  peer.pendingIce = [];
                } catch (err) {
                  console.warn('Answer err:', err);
                }
              }
            } else if (sig.type === 'ice') {
              const peer = broadcasterPeersRef.current.get(sig.from_peer);
              if (peer) {
                if (peer.pc.remoteDescription) {
                  await peer.pc
                    .addIceCandidate(new RTCIceCandidate(sig.payload as RTCIceCandidateInit))
                    .catch(() => {});
                } else {
                  peer.pendingIce.push(sig.payload as RTCIceCandidateInit);
                }
              }
            }
          }
        )
        .subscribe();

      signalChannelRef.current = channel;

      setState({ kind: 'broadcasting', sessionId });
      onNotice({ kind: 'success', text: 'Canlı yayın başladı.' });
    } catch (err) {
      cleanupAll();
      const message = err instanceof Error ? err.message : 'Kamera hatası.';
      setState({ kind: 'error', message });
      onNotice({ kind: 'error', text: message });
    }
  }, [configured, isSignedIn, isActive, selectedPin, session, onNotice, onAuthRequired, cleanupAll, createOfferForViewer]);

  const endBroadcast = useCallback(
    async (sessionId: string) => {
      cleanupAll();
      if (liveSupabase) {
        await liveSupabase
          .from('live_sessions')
          .update({ status: 'ended', ended_at: new Date().toISOString() })
          .eq('id', sessionId);
      }
      setState({ kind: 'idle' });
    },
    [cleanupAll]
  );

  const watchSession = useCallback(
    async (target: LiveSession) => {
      if (!liveSupabase || !session?.user?.id) {
        onAuthRequired();
        return;
      }
      setState({ kind: 'starting' });
      setShowViewerList(false);

      const viewerId = session.user.id;
      const broadcasterId = target.broadcaster_id;

      try {
        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        viewerPeerRef.current = pc;

        const remoteStream = new MediaStream();
        pc.ontrack = (event) => {
          event.streams[0]?.getTracks().forEach((t) => remoteStream.addTrack(t));
          if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
        };

        pc.onicecandidate = (event) => {
          if (event.candidate) {
            void liveSupabase!.from('live_signals').insert({
              session_id: target.id,
              from_peer: viewerId,
              to_peer: broadcasterId,
              type: 'ice',
              payload: event.candidate.toJSON(),
            });
          }
        };

        const channel = liveSupabase
          .channel(`viewer-signals-${target.id}-${viewerId}`)
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
              if (sig.to_peer !== viewerId) return;
              try {
                if (sig.type === 'offer') {
                  await pc.setRemoteDescription(
                    new RTCSessionDescription(sig.payload as unknown as RTCSessionDescriptionInit)
                  );
                  const answer = await pc.createAnswer();
                  await pc.setLocalDescription(answer);
                  await liveSupabase!.from('live_signals').insert({
                    session_id: target.id,
                    from_peer: viewerId,
                    to_peer: broadcasterId,
                    type: 'answer',
                    payload: answer,
                  });
                } else if (sig.type === 'ice') {
                  await pc
                    .addIceCandidate(new RTCIceCandidate(sig.payload as RTCIceCandidateInit))
                    .catch(() => {});
                }
              } catch (err) {
                console.warn('Viewer signal err:', err);
              }
            }
          )
          .subscribe();

        signalChannelRef.current = channel;

        await liveSupabase.from('live_signals').insert({
          session_id: target.id,
          from_peer: viewerId,
          to_peer: broadcasterId,
          type: 'join',
          payload: {},
        });

        setState({ kind: 'watching', sessionId: target.id });
      } catch (err) {
        cleanupAll();
        const message = err instanceof Error ? err.message : 'Bağlantı hatası.';
        setState({ kind: 'error', message });
        onNotice({ kind: 'error', text: message });
      }
    },
    [session, onNotice, onAuthRequired, cleanupAll]
  );

  const closePlayer = useCallback(() => {
    cleanupAll();
    setState({ kind: 'idle' });
  }, [cleanupAll]);

  useEffect(() => () => cleanupAll(), [cleanupAll]);

  const isBusy = state.kind === 'starting';
  const broadcasting = state.kind === 'broadcasting';
  const watching = state.kind === 'watching';

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
        className={`aytar-live-button ${broadcasting || watching ? 'is-active ' : ''}${isBusy ? 'is-busy' : ''}`}
        onClick={() => {
          if (broadcasting) void endBroadcast(state.sessionId);
          else if (watching) closePlayer();
          else if (selectedPin) void startBroadcast();
          else setShowViewerList(true);
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
          <>
            <Radio size={16} />
            <span className="aytar-live-count">{activeSessions.length}</span>
          </>
        ) : (
          <Video size={16} />
        )}
      </button>

      {broadcasting && (
        <div className="aytar-live-overlay" role="dialog" aria-label="Canlı yayın">
          <div className="aytar-live-header">
            <span className="aytar-live-live-dot" />
            <strong>CANLI</strong>
            <span style={{ fontSize: 11, opacity: 0.75 }}>
              {broadcasterPeersRef.current.size} izleyici
            </span>
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