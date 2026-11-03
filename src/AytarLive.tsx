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

type Session = { user?: { id: string } } | null;

interface AytarLiveProps {
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

export default function AytarLive({ profile, session, onNotice, onAuthRequired }: AytarLiveProps) {
  const [state, setState] = useState<ComponentState>({ kind: 'idle' });
  const [activeSessions, setActiveSessions] = useState<LiveSession[]>([]);
  const [showViewerList, setShowViewerList] = useState(false);
  const [showSessionChoices, setShowSessionChoices] = useState(false);
  
  // WebRTC Stream'lerini State'te tutuyoruz ki React render ettiğinde bağlayabilelim
  const [localStreamState, setLocalStreamState] = useState<MediaStream | null>(null);
  const [remoteStreamState, setRemoteStreamState] = useState<MediaStream | null>(null);

  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const broadcasterPeersRef = useRef<Map<string, BroadcasterPeer>>(new Map());
  const viewerPeerRef = useRef<RTCPeerConnection | null>(null);
  const signalChannelRef = useRef<any>(null);

  const isActive = profile?.status === 'active';
  const isSignedIn = Boolean(session?.user?.id);
  const configured = isLiveConfigured && Boolean(liveSupabase);

  // Yayınları Dinle
  useEffect(() => {
    const supa = liveSupabase;
    if (!supa) return;

    const channel = supa
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

    void supa.from('live_sessions')
      .select('*')
      .eq('status', 'live')
      .then(({ data }) => {
        if (data) setActiveSessions(data as LiveSession[]);
      });

    return () => {
      void supa.removeChannel(channel);
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
    
    setLocalStreamState(null);
    setRemoteStreamState(null);
  }, []);

  const createOfferForViewer = useCallback(
    async (sessionId: string, broadcasterId: string, viewerId: string) => {
      const supa = liveSupabase;
      if (!supa || !localStreamRef.current) return;
      
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
          void supa.from('live_signals').insert({
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
        await supa.from('live_signals').insert({
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
    const supa = liveSupabase;
    if (!configured || !supa) {
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

    setState({ kind: 'starting' });

    try {
      let currentLat = 41.0082;
      let currentLng = 28.9784;
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 5000 });
        });
        currentLat = pos.coords.latitude;
        currentLng = pos.coords.longitude;
      } catch (e) {
        console.warn('GPS alınamadı, varsayılan kullanılıyor.');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'environment' },
        audio: true,
      });
      localStreamRef.current = stream;
      setLocalStreamState(stream); // Video elementine bağlanması için state'e at

      const jittered = jitterCoords(currentLat, currentLng);

      const { data, error } = await supa
        .from('live_sessions')
        .insert({
          broadcaster_id: session!.user!.id,
          pin_id: null,
          lat: jittered.lat,
          lng: jittered.lng,
          status: 'live',
          title: 'Canlı Yayın',
        })
        .select('id')
        .single();

      if (error || !data) throw new Error(error?.message || 'Yayın başlatılamadı.');

      const sessionId = data.id;
      const broadcasterId = session!.user!.id;

      const channel = supa
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
                  await peer.pc.addIceCandidate(new RTCIceCandidate(sig.payload as RTCIceCandidateInit)).catch(() => {});
                } else {
                  peer.pendingIce.push(sig.payload as RTCIceCandidateInit);
                }
              }
            }
          }
        );

      signalChannelRef.current = channel;
      await new Promise<void>((resolve, reject) => {
        channel.subscribe((status) => {
          if (status === 'SUBSCRIBED') resolve();
          else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            reject(new Error(`Yayın sinyal kanalı bağlanamadı: ${status}`));
          }
        });
      });

      setState({ kind: 'broadcasting', sessionId });
      onNotice({ kind: 'success', text: 'Canlı yayın başladı.' });
    } catch (err) {
      cleanupAll();
      const message = err instanceof Error ? err.message : 'Kamera hatası.';
      setState({ kind: 'error', message });
      onNotice({ kind: 'error', text: message });
    }
  }, [configured, isSignedIn, isActive, session, onNotice, onAuthRequired, cleanupAll, createOfferForViewer]);

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
      const supa = liveSupabase;
      if (!supa || !session?.user?.id) {
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
        const pendingViewerIce: RTCIceCandidateInit[] = [];

        pc.ontrack = (event) => {
          // Bazı tarayıcılar event.streams dizisini boş gönderebilir; track'i doğrudan al.
          const incomingTracks = event.streams?.[0]?.getTracks() ?? [event.track];
          for (const track of incomingTracks) {
            if (!remoteStream.getTracks().some((existing) => existing.id === track.id)) {
              remoteStream.addTrack(track);
            }
          }
          console.info('[AYTAR LIVE] İzleyici track aldı:', event.track.kind, event.track.readyState);
          setRemoteStreamState(remoteStream);
        };

        pc.onicecandidate = (event) => {
          if (event.candidate) {
            void supa.from('live_signals').insert({
              session_id: target.id,
              from_peer: viewerId,
              to_peer: broadcasterId,
              type: 'ice',
              payload: event.candidate.toJSON(),
            });
          }
        };

        const channel = supa
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
                  for (const ice of pendingViewerIce) {
                    await pc.addIceCandidate(new RTCIceCandidate(ice));
                  }
                  pendingViewerIce.length = 0;
                  const answer = await pc.createAnswer();
                  await pc.setLocalDescription(answer);
                  await supa.from('live_signals').insert({
                    session_id: target.id,
                    from_peer: viewerId,
                    to_peer: broadcasterId,
                    type: 'answer',
                    payload: answer,
                  });
                } else if (sig.type === 'ice') {
                  const candidate = sig.payload as RTCIceCandidateInit;
                  if (pc.remoteDescription) {
                    await pc.addIceCandidate(new RTCIceCandidate(candidate));
                  } else {
                    pendingViewerIce.push(candidate);
                  }
                }
              } catch (err) {
                console.warn('Viewer signal err:', err);
              }
            }
          );

        signalChannelRef.current = channel;
        await new Promise<void>((resolve, reject) => {
          channel.subscribe((status) => {
            if (status === 'SUBSCRIBED') resolve();
            else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
              reject(new Error(`İzleyici sinyal kanalı bağlanamadı: ${status}`));
            }
          });
        });

        // Video öğesini, yayıncıya join sinyali göndermeden önce DOM'a yerleştir.
        // Böylece ontrack geldiğinde React video öğesini sonradan oluşturup oynatmayı kesmez.
        setState({ kind: 'watching', sessionId: target.id });

        // React'in izleyici penceresini DOM'a yerleştirmesini bekle.
        // Join sinyali bundan sonra gider; yayıncı offer gönderdiğinde video öğesi hazır olur.
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });

        const { error: joinError } = await supa.from('live_signals').insert({
          session_id: target.id,
          from_peer: viewerId,
          to_peer: broadcasterId,
          type: 'join',
          payload: {},
        });
        if (joinError) throw joinError;
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

  // Bileşen kapandığında temizlik
  useEffect(() => () => cleanupAll(), [cleanupAll]);

  // Video penceresi state değişimiyle DOM'a eklendiğinde akışı yeniden bağla.
  // getUserMedia sonucu, pencere oluşturulmadan önce gelebileceği için state.kind de bağımlılıkta.
  useEffect(() => {
    const attachAndPlay = (video: HTMLVideoElement, stream: MediaStream, label: string) => {
      if (video.srcObject !== stream) {
        video.srcObject = stream;
      }
      video.autoplay = true;
      video.playsInline = true;
      video.muted = true;

      const play = () => {
        void video.play().catch((err) => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          console.warn(`[AYTAR LIVE] ${label} video oynatılamadı:`, err);
        });
      };

      if (video.readyState >= HTMLMediaElement.HAVE_METADATA) play();
      else video.onloadedmetadata = play;
    };

    if (state.kind === 'broadcasting' && localVideoRef.current && localStreamState) {
      attachAndPlay(localVideoRef.current, localStreamState, 'Yayıncı');
    }

    if (state.kind === 'watching' && remoteVideoRef.current && remoteStreamState) {
      attachAndPlay(remoteVideoRef.current, remoteStreamState, 'İzleyici');
    }
  }, [localStreamState, remoteStreamState, state.kind]);

  // İzleyici siyah ekran teşhisi: bağlantı, ICE, video elementi ve gerçek medya sayaçları.
  useEffect(() => {
    if (state.kind !== 'watching') return;

    const inspectViewer = async () => {
      const pc = viewerPeerRef.current;
      const video = remoteVideoRef.current;
      const stream = video?.srcObject instanceof MediaStream
        ? video.srcObject
        : remoteStreamState;

      const tracks = stream?.getTracks().map((track) => ({
        kind: track.kind,
        readyState: track.readyState,
        enabled: track.enabled,
        muted: track.muted,
      })) ?? [];

      console.info('[AYTAR LIVE DEBUG] İzleyici durumu', {
        connectionState: pc?.connectionState ?? 'PEER YOK',
        iceConnectionState: pc?.iceConnectionState ?? 'PEER YOK',
        signalingState: pc?.signalingState ?? 'PEER YOK',
        videoElement: Boolean(video),
        videoReadyState: video?.readyState ?? null,
        videoPaused: video?.paused ?? null,
        videoWidth: video?.videoWidth ?? null,
        videoHeight: video?.videoHeight ?? null,
        videoSrcObject: Boolean(video?.srcObject),
        remoteTracks: tracks,
      });

      if (!pc) return;
      try {
        const stats = await pc.getStats();
        const inbound = Array.from(stats.values())
          .filter((item) => item.type === 'inbound-rtp')
          .map((item) => ({
            kind: item.kind ?? item.mediaType,
            bytesReceived: item.bytesReceived,
            packetsReceived: item.packetsReceived,
            packetsLost: item.packetsLost,
            framesReceived: item.framesReceived,
            framesDecoded: item.framesDecoded,
            framesDropped: item.framesDropped,
          }));
        const candidatePairs = Array.from(stats.values())
          .filter((item) => item.type === 'candidate-pair' && item.state === 'succeeded')
          .map((item) => ({
            nominated: item.nominated,
            currentRoundTripTime: item.currentRoundTripTime,
            bytesReceived: item.bytesReceived,
            bytesSent: item.bytesSent,
          }));
        console.info('[AYTAR LIVE DEBUG] Medya istatistikleri', { inbound, candidatePairs });
      } catch (err) {
        console.warn('[AYTAR LIVE DEBUG] getStats başarısız:', err);
      }
    };

    void inspectViewer();
    const intervalId = window.setInterval(() => void inspectViewer(), 3000);
    return () => window.clearInterval(intervalId);
  }, [remoteStreamState, state.kind]);

  const isBusy = state.kind === 'starting';
  const broadcasting = state.kind === 'broadcasting';
  const watching = state.kind === 'watching';

  const buttonTitle = broadcasting
    ? 'Yayını bitir'
    : watching
    ? 'İzlemeyi kapat'
    : activeSessions.length > 0
    ? `${activeSessions.length} canlı yayın izle`
    : isSignedIn && isActive
    ? 'Canlı yayın aç'
    : isSignedIn
    ? 'Hesabı etkinleştir'
    : 'Giriş yap';

  return (
    <>
      <button
        type="button"
        className={`aytar-live-button ${broadcasting || watching ? 'is-active ' : ''}${isBusy ? 'is-busy' : ''}`}
        onClick={() => {
          setShowSessionChoices(false);
          setShowViewerList((open) => !open);
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
          <video 
            ref={localVideoRef}
            autoPlay 
            muted 
            playsInline 
            className="aytar-live-video" 
          />
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
          <video 
            ref={remoteVideoRef}
            autoPlay 
            muted
            playsInline 
            className="aytar-live-video" 
          />
        </div>
      )}

      {showViewerList && (
        <div className="aytar-live-viewer-list" role="dialog" aria-label="Canlı yayın kontrol paneli">
          <div className="aytar-live-header">
            <Radio size={18} />
            <strong>CANLI YAYIN</strong>
            <button type="button" onClick={() => { setShowViewerList(false); setShowSessionChoices(false); }} aria-label="Paneli kapat">
              <X size={18} />
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12 }}>
            {broadcasting ? (
              <button
                type="button"
                className="aytar-live-session-item"
                onClick={() => void endBroadcast(state.sessionId)}
                style={{ justifyContent: 'center', background: '#7f1d1d', color: '#fff' }}
              >
                <VideoOff size={16} />
                <span>Canlı yayını sonlandır</span>
              </button>
            ) : watching ? (
              <button
                type="button"
                className="aytar-live-session-item"
                onClick={closePlayer}
                style={{ justifyContent: 'center' }}
              >
                <EyeOff size={16} />
                <span>Canlı yayını kapat</span>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="aytar-live-session-item"
                  onClick={() => { setShowViewerList(false); void startBroadcast(); }}
                  disabled={!isSignedIn || !isActive || isBusy}
                  style={{ justifyContent: 'center' }}
                  title={!isSignedIn ? 'Önce giriş yapmalısın' : !isActive ? 'Aktif üyelik gerekli' : 'Kameranı aç ve yayın başlat'}
                >
                  <Video size={16} />
                  <span>Canlı yayın aç</span>
                </button>
                <button
                  type="button"
                  className="aytar-live-session-item"
                  onClick={() => setShowSessionChoices((open) => !open)}
                  disabled={activeSessions.length === 0}
                  style={{ justifyContent: 'center', opacity: activeSessions.length === 0 ? 0.55 : 1 }}
                >
                  <Eye size={16} />
                  <span>Canlı yayın izle ({activeSessions.length})</span>
                </button>
              </>
            )}
          </div>

          {showSessionChoices && !broadcasting && !watching && (
            activeSessions.length === 0 ? (
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
            )
          )}
        </div>
      )}
    </>
  );
}