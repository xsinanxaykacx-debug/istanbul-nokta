import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { Camera, CircleStop, Radio, X } from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
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
  onOpen: () => void;
  onClose: () => void;
};

const livePinIcon = L.divIcon({
  className: 'pin-icon-wrap',
  html: '<div class="neon-pin-icon" style="width:42px;height:42px;display:grid;place-items:center;border-radius:50%;background:#0f172a;border:2px solid #00E5FF;box-shadow:0 0 12px #00E5FF;color:#00E5FF;font:700 9px Arial,sans-serif;letter-spacing:.2px">CANLI</div>',
  iconSize: [42, 42],
  iconAnchor: [21, 21],
});

export default function LiveBroadcast({ session, active, open, onOpen, onClose }: Props) {
  const map = useMap();
  const clientId = useMemo(() => crypto.randomUUID(), []);
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [publisherSession, setPublisherSession] = useState<{ id: string; room_id: string } | null>(null);
  const [publisherStream, setPublisherStream] = useState<MediaStream | null>(null);
  const [viewerSession, setViewerSession] = useState<LiveSession | null>(null);
  const [selectedSession, setSelectedSession] = useState<LiveSession | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const [remoteVideoStream, setRemoteVideoStream] = useState<MediaStream | null>(null);
  const previewRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);
  const publisher = useBroadcast(supabase, publisherSession?.room_id ?? null, clientId, publisherStream);
  const viewer = useViewer(supabase, viewerSession?.room_id ?? null, clientId);

  const refreshSessions = useCallback(async () => {
    if (!supabase || !session || !active) return;
    const { data, error } = await supabase.from('live_sessions_public')
      .select('id,user_id,lat,lng,room_id,started_at');
    if (!error) setSessions((data ?? []) as LiveSession[]);
  }, [session, active]);

  useEffect(() => {
    if (!supabase || !session || !active) { setSessions([]); return; }
    void refreshSessions();
    const channel = supabase.channel('aytar-live-session-map')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'live_sessions' }, () => void refreshSessions())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [session, active, refreshSessions]);

  useEffect(() => {
    if (previewRef.current) previewRef.current.srcObject = previewStream;
  }, [previewStream, open]);

  useEffect(() => {
    if (remoteRef.current) remoteRef.current.srcObject = viewer.remoteStream;
  }, [viewer.remoteStream, viewerSession]);

  useEffect(() => {
    if (!publisherSession || !supabase) return;
    const timer = window.setInterval(() => {
      void supabase.functions.invoke('live-session', {
        body: { action: 'heartbeat', session_id: publisherSession.id },
      }).then(({ error }) => {
        if (error) setNotice('Yayın bağlantısı yenilenemedi.');
      });
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [publisherSession]);

  useEffect(() => () => {
    previewStream?.getTracks().forEach(track => track.stop());
    publisherStream?.getTracks().forEach(track => track.stop());
  }, [previewStream, publisherStream]);

  const requestCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      previewStream?.getTracks().forEach(track => track.stop());
      setPreviewStream(stream);
      setNotice('Kamera ve mikrofon hazır.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Kamera izni alınamadı.');
    }
  };

  const startBroadcast = async () => {
    if (!supabase || !session || !active) return;
    setBusy(true);
    let stream: MediaStream | null = null;
    try {
      stream = previewStream ?? await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      const position = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15000 }),
      );
      const { data, error } = await supabase.functions.invoke('live-session', {
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
      onClose();
      await refreshSessions();
    } catch (error) {
      stream?.getTracks().forEach(track => track.stop());
      setNotice(error instanceof Error ? error.message : 'Kamera veya konum izni alınamadı.');
    } finally {
      setBusy(false);
    }
  };

  const endBroadcast = async () => {
    if (!supabase || !publisherSession) return;
    setBusy(true);
    const { error } = await supabase.functions.invoke('live-session', {
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
    if (!supabase || !session || !active) {
      setNotice('Canlı yayınları izlemek için aktif üyelik gerekir.');
      return;
    }
    setBusy(true);
    const { data, error } = await supabase.functions.invoke('live-session', {
      body: { action: 'join', session_id: row.id },
    });
    if (error || !data?.session?.room_id) {
      setNotice(error instanceof Error ? error.message : 'Yayına katılınamadı.');
      setBusy(false);
      return;
    }
    setViewerSession({ ...row, room_id: data.session.room_id });
    setSelectedSession(null);
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
            <div className="live-control-preview">
              <video ref={previewRef} autoPlay muted playsInline />
              {!previewStream && !publisherStream && <span><Camera size={22}/> Kamera önizlemesi</span>}
            </div>
            <p className="info-text">{publisherSession ? publisher.status : 'Konum, yayın başlatılırken GPS üzerinden alınır.'}</p>
            {!publisherSession ? <div className="live-control-actions">
              <button type="button" className="secondary-button" onClick={() => void requestCamera()} disabled={busy || !!previewStream}><Camera size={16}/> Kamera İzni Ver</button>
              <button type="button" className="primary-button" onClick={() => void startBroadcast()} disabled={busy}>{busy ? 'Hazırlanıyor…' : 'Yayına Başla'}</button>
            </div> : <div className="live-control-actions">
              <button type="button" className="delete-pin-button" onClick={() => void endBroadcast()} disabled={busy}><CircleStop size={16}/> Yayını Bitir</button>
            </div>}
          </>}
        {viewerSession && <div className="live-viewer-card">
          <div className="modal-head"><div><p className="eyebrow">CANLI İZLEME</p><h3>Yayın</h3></div><button type="button" className="icon-button" onClick={closeViewer} aria-label="İzlemeyi kapat"><X size={16}/></button></div>
          <video ref={remoteRef} autoPlay playsInline controls />
          <small>{viewer.status}</small>
        </div>}
        {notice && <p className="info-text" role="status">{notice}</p>}
      </section>
    </div>, document.body,
  ) : null;

  return <>
    <button type="button" className="map-control" onClick={onOpen} title="Canlı Yayın" aria-label="Canlı Yayın">
      <Radio size={18}/>
    </button>
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
