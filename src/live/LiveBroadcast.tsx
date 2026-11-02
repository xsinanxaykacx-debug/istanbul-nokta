import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import { Camera, CircleStop, X } from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import { liveSupabase } from '../lib/liveSupabase';
import { useBroadcast, useViewer } from './useWebRTC';

type LiveSession = {
  id: string;
  user_id: string;
  lat: number;
  lng: number;
  room_id: string;
  started_at: string;
};

type Props = {
  session: Session | null;
  active: boolean;
  open: boolean;
  onClose: () => void;
};

const livePinIcon = L.divIcon({
  className: 'pin-icon-wrap',
  html: '<div style="width:34px;height:34px;position:relative;transform:rotate(-45deg);background:#1e6348;border:3px solid #fff;border-radius:50% 50% 50% 4px;box-shadow:0 3px 8px #152b1c55;display:grid;place-items:center"><span style="transform:rotate(45deg);font:800 7px Arial,sans-serif;letter-spacing:-.3px;color:#fff;white-space:nowrap">CANLI</span></div>',
  iconSize: [34, 34],
  iconAnchor: [17, 17],
});

export default function LiveBroadcast({ session, active, open, onClose }: Props) {
  const clientId = useMemo(() => crypto.randomUUID(), []);
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [publisherSession, setPublisherSession] = useState<{ id: string; room_id: string } | null>(null);
  const [publisherStream, setPublisherStream] = useState<MediaStream | null>(null);
  const [viewerSession, setViewerSession] = useState<LiveSession | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const previewRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);
  const publisher = useBroadcast(liveSupabase, publisherSession?.room_id ?? null, clientId, publisherStream);
  const viewer = useViewer(liveSupabase, viewerSession?.room_id ?? null, clientId);

  const refreshSessions = useCallback(async () => {
    if (!liveSupabase || !session || !active) return;
    const { data, error } = await liveSupabase.from('live_sessions_public')
      .select('id,user_id,lat,lng,room_id,started_at');
    if (!error) setSessions((data ?? []) as LiveSession[]);
  }, [session, active]);

  useEffect(() => {
    if (!liveSupabase || !session || !active) { setSessions([]); return; }
    void refreshSessions();
    const client = liveSupabase;
    const channel = client.channel('aytar-live-session-map')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'live_sessions' }, () => void refreshSessions())
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [session, active, refreshSessions]);

  // Keep the local camera visible after the preview stream becomes the publisher stream.
  useEffect(() => {
    const video = previewRef.current;
    const localStream = publisher.localStream ?? previewStream;
    if (video && video.srcObject !== localStream) video.srcObject = localStream;
    if (video && localStream) void video.play().catch(() => undefined);
  }, [publisher.localStream, previewStream, open]);

  useEffect(() => {
    if (remoteRef.current) remoteRef.current.srcObject = viewer.remoteStream;
  }, [viewer.remoteStream, viewerSession]);

  useEffect(() => {
    if (!publisherSession || !liveSupabase || !session?.access_token) return;
    const client = supabase;
    const timer = window.setInterval(() => {
      void client.functions.invoke('live-session', {
        body: { action: 'heartbeat', session_id: publisherSession.id },
      }).then(({ error }) => {
        if (error) setNotice('Yayın bağlantısı yenilenemedi.');
      });
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [publisherSession, session?.access_token]);

  const streamsRef = useRef<{ preview: MediaStream | null; publisher: MediaStream | null }>({ preview: null, publisher: null });
  useEffect(() => { streamsRef.current = { preview: previewStream, publisher: publisherStream }; }, [previewStream, publisherStream]);
  useEffect(() => () => {
    const current = streamsRef.current;
    current.preview?.getTracks().forEach(track => track.stop());
    current.publisher?.getTracks().forEach(track => track.stop());
  }, []);

  const requestCamera = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Bu tarayıcı kamera erişimini desteklemiyor.');
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      previewStream?.getTracks().forEach(track => track.stop());
      setPreviewStream(stream);
      setNotice('Kamera ve mikrofon hazır.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Kamera izni alınamadı.');
    }
  };

  const startBroadcast = async () => {
    if (!liveSupabase || !session || !active) return;
    setBusy(true);
    let stream: MediaStream | null = null;
    try {
      stream = previewStream ?? await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      const position = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15000 }),
      );
      const { data, error } = await liveSupabase.functions.invoke('live-session', {
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: {
          action: 'start',
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          pin_id: crypto.randomUUID(),
        },
      });
      if (error || !data?.session?.id || !data?.session?.room_id) throw error ?? new Error('Yayın oturumu oluşturulamadı.');
      setPublisherStream(stream);
      setPreviewStream(null);
      setPublisherSession({ id: data.session.id, room_id: data.session.room_id });
      setNotice('Canlı yayın başlatıldı.');
      // Keep the panel open so the publisher can see their own live camera preview.
      await refreshSessions();
    } catch (error) {
      stream?.getTracks().forEach(track => track.stop());
      setNotice(error instanceof Error ? error.message : 'Kamera veya konum izni alınamadı.');
    } finally {
      setBusy(false);
    }
  };

  const endBroadcast = async () => {
    if (!liveSupabase || !publisherSession || !session?.access_token) return;
    setBusy(true);
    const { error } = await liveSupabase.functions.invoke('live-session', {
      headers: { Authorization: `Bearer ${session.access_token}` },
      body: { action: 'end', session_id: publisherSession.id },
    });
    if (error) {
      setNotice('Yayın kapatılamadı. Bağlantı durumunu kontrol et.');
      setBusy(false);
      return;
    }
    publisherStream?.getTracks().forEach(track => track.stop());
    setPublisherStream(null);
    setPublisherSession(null);
    await refreshSessions();
    setNotice('Yayın sona erdi.');
    setBusy(false);
  };

  const joinSession = async (row: LiveSession) => {
    if (!liveSupabase || !session || !active) {
      setNotice('Canlı yayınları izlemek için aktif üyelik gerekir.');
      return;
    }
    setBusy(true);
    const { data, error } = await liveSupabase.functions.invoke('live-session', {
      headers: { Authorization: `Bearer ${session.access_token}` },
      body: { action: 'join', session_id: row.id },
    });
    if (error || !data?.session?.room_id) {
      setNotice(error instanceof Error ? error.message : 'Yayına katılınamadı.');
      setBusy(false);
      return;
    }
    setViewerSession({ ...row, room_id: data.session.room_id });
    setNotice('Yayın bağlantısı kuruluyor.');
    setBusy(false);
  };

  const closeViewer = () => {
    setViewerSession(null);
    setNotice('İzleyici bağlantısı kapatıldı.');
  };

  const panel = open ? createPortal(
    <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="invite-modal" role="dialog" aria-modal="true" aria-labelledby="aytar-live-title">
        <div className="modal-head">
          <div><p className="eyebrow">AYTAR LIVE</p><h2 id="aytar-live-title">Canlı Yayın</h2></div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Kapat"><X size={18}/></button>
        </div>
        {!session ? <p className="info-text">Canlı yayın başlatmak için giriş yapmalısın.</p>
          : !active ? <p className="info-text">Canlı yayın için aktif üyelik gerekir.</p>
          : <>
            <div style={{position:'relative',width:'100%',height:220,background:'#101a16',borderRadius:14,overflow:'hidden',display:'grid',placeItems:'center'}}>
              <video ref={previewRef} autoPlay muted playsInline style={{width:'100%',height:'100%',objectFit:'cover'}} />
              {!previewStream && !publisherStream && <span style={{display:'flex',alignItems:'center',gap:8,color:'var(--text-muted)',fontSize:13}}><Camera size={22}/> Kamera önizlemesi</span>}
            </div>
            <p className="info-text">{publisherSession ? publisher.status : 'Konum, yayın başlatılırken GPS üzerinden alınır.'}</p>
            {!publisherSession ? <div style={{display:"grid",gap:10,marginTop:16}}>
              <button type="button" className="secondary-button" onClick={() => void requestCamera()} disabled={busy || !!previewStream}><Camera size={16}/> Kamera İzni Ver</button>
              <button type="button" className="primary-button" onClick={() => void startBroadcast()} disabled={busy}>{busy ? 'Hazırlanıyor…' : 'Yayına Başla'}</button>
            </div> : <div style={{display:"grid",gap:10,marginTop:16}}>
              <button type="button" className="delete-pin-button" onClick={() => void endBroadcast()} disabled={busy}><CircleStop size={16}/> Yayını Bitir</button>
            </div>}
          </>}
        {viewerSession && <div style={{marginTop:18,paddingTop:16,borderTop:"1px solid var(--border-color)"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><div><p className="eyebrow">CANLI İZLEME</p><h3>Yayın</h3></div><button type="button" className="icon-button" onClick={closeViewer} aria-label="İzlemeyi kapat"><X size={16}/></button></div>
          <video ref={remoteRef} autoPlay playsInline controls style={{width:"100%",maxHeight:320,background:"#111",borderRadius:12,marginTop:10}} />
          <small className="info-text">{viewer.status}</small>
        </div>}
        {notice && <p className="info-text" role="status">{notice}</p>}
      </section>
    </div>, document.body,
  ) : null;

  return <>
    {sessions.map(row => <Marker key={row.id} position={[row.lat, row.lng]} icon={livePinIcon} keyboard title="CANLI yayın">
      <Popup>
        <div className="user-location-popup">
          <strong>CANLI YAYIN</strong>
          <span>{new Date(row.started_at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</span>
          <button type="button" onClick={() => void joinSession(row)} disabled={busy || row.user_id === session?.user?.id}>
            {row.user_id === session?.user?.id ? 'Kendi yayınınız' : busy ? 'Bağlanıyor…' : 'Yayını İzle'}
          </button>
        </div>
      </Popup>
    </Marker>)}
    {panel}
  </>;
}
