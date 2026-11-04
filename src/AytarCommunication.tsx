import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MessageCircle, Users, X, Send, Search, Circle, ArrowLeft, LoaderCircle,
  Video, Phone, MessagesSquare, PhoneCall, PhoneOff, Mic, MicOff, Camera, CameraOff
} from 'lucide-react';
import { supabase } from './lib/supabase';
import { ICE_SERVERS } from './lib/liveClient';

type Profile = { id: string; status: 'pending' | 'active' | 'disabled'; role: 'user' | 'admin'; username: string | null };
type Session = { user?: { id: string } } | null;
type Member = { user_id: string; username: string; last_seen_at: string };
type DirectMessage = { id: string; sender_id: string; recipient_id: string; body: string; created_at: string };
type ChatSummary = { member: Member; lastMessage: DirectMessage };
type CallKind = 'audio' | 'video';
type SignalKind = 'offer' | 'answer' | 'ice' | 'reject' | 'hangup';
type CallSignal = {
  id: string; call_id: string; sender_id: string; recipient_id: string;
  kind: SignalKind; payload: Record<string, unknown>; created_at: string;
};
type IncomingCall = { callId: string; peerId: string; peerName: string; mode: CallKind; offer: RTCSessionDescriptionInit };
type CallHistoryItem = { id: string; peerName: string; mode: CallKind; direction: 'incoming' | 'outgoing'; result: 'completed' | 'missed' | 'rejected' | 'cancelled' | 'failed'; startedAt: string; duration: number };

interface Props {
  profile: Profile | null;
  session: Session;
  onNotice: (notice: { kind: 'success' | 'error' | 'info'; text: string }) => void;
  onAuthRequired: () => void;
}

export default function AytarCommunication({ profile, session, onNotice, onAuthRequired }: Props) {
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [selected, setSelected] = useState<Member | null>(null);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [loadingChats, setLoadingChats] = useState(false);
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [tab, setTab] = useState<'members' | 'chats' | 'meetings' | 'calls'>('members');

  const [callStatus, setCallStatus] = useState<'idle' | 'calling' | 'ringing' | 'connecting' | 'active'>('idle');
  const [callMode, setCallMode] = useState<CallKind>('audio');
  const [callPeerName, setCallPeerName] = useState('');
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [signalingReady, setSignalingReady] = useState(false);
  const [callHistory, setCallHistory] = useState<CallHistoryItem[]>(() => {
    try { return JSON.parse(localStorage.getItem('aytar-call-history-v1') || '[]') as CallHistoryItem[]; }
    catch { return []; }
  });
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const seenSignalIdsRef = useRef<Set<string>>(new Set());
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const pendingLocalIceRef = useRef<RTCIceCandidateInit[]>([]);
  const localIceReadyRef = useRef(true);
  const incomingCallRef = useRef<IncomingCall | null>(null);
  const callIdRef = useRef<string | null>(null);
  const callPeerRef = useRef<string | null>(null);
  const callStatusRef = useRef<'idle' | 'calling' | 'ringing' | 'connecting' | 'active'>('idle');
  const callCreatedAtRef = useRef<number | null>(null);
  const callConnectedAtRef = useRef<number | null>(null);
  const callDirectionRef = useRef<'incoming' | 'outgoing'>('outgoing');
  const callPeerNameRef = useRef('');
  const callModeRef = useRef<CallKind>('audio');
  const callHistorySavedRef = useRef(false);
  const disconnectTimerRef = useRef<number | null>(null);
  const signalingReadyRef = useRef(false);
  const userId = session?.user?.id;
  const active = Boolean(userId && profile?.status === 'active');

  const updateCallStatus = (next: typeof callStatusRef.current) => {
    callStatusRef.current = next;
    setCallStatus(next);
  };

  const loadMembers = useCallback(async () => {
    if (!supabase || !active) return;
    setLoadingMembers(true);
    const { data, error } = await supabase.rpc('aytar_online_members');
    if (error) console.warn('[AYTAR İLETİŞİM] Üye listesi alınamadı:', error.message);
    else setMembers((data ?? []) as Member[]);
    setLoadingMembers(false);
  }, [active]);

  // Presence heartbeat: offline status expires after 90 seconds.
  const presenceErrorShownRef = useRef(false);
  useEffect(() => {
    if (!active || !supabase || !userId) return;
    let disposed = false;
    const publishPresence = async () => {
      const { error } = await supabase!.from('aytar_presence').upsert(
        { user_id: userId, last_seen_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      );
      if (disposed) return;
      if (error) {
        console.warn('[AYTAR İLETİŞİM] Çevrimiçi durumu yazılamadı:', error.message, error.code);
        if (!presenceErrorShownRef.current) {
          presenceErrorShownRef.current = true;
          onNotice({ kind: 'error', text: `Çevrimiçi durumun kaydedilemedi: ${error.message}` });
        }
      } else presenceErrorShownRef.current = false;
    };
    void publishPresence();
    const heartbeat = window.setInterval(() => void publishPresence(), 30000);
    return () => { disposed = true; window.clearInterval(heartbeat); };
  }, [active, userId, onNotice]);

  // Private signaling is row-scoped by recipient_id and protected by RLS.
  const sendSignal = useCallback(async (recipientId: string, callId: string, kind: SignalKind, payload: Record<string, unknown> = {}) => {
    if (!supabase || !userId) throw new Error('Arama için oturum bulunamadı.');
    const { error } = await supabase.from('aytar_call_signals').insert({
      call_id: callId, sender_id: userId, recipient_id: recipientId, kind, payload
    });
    if (error) throw new Error(error.message);
  }, [userId]);

  const flushPendingIce = useCallback(async (pc: RTCPeerConnection) => {
    const queued = [...pendingIceRef.current];
    pendingIceRef.current = [];
    for (const candidate of queued) {
      try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); }
      catch (error) { console.warn('[AYTAR ARAMA] ICE adayı eklenemedi:', error); }
    }
  }, []);

  const closeCallMedia = useCallback((result?: CallHistoryItem['result']) => {
    const callId = callIdRef.current;
    if (callId && callCreatedAtRef.current && !callHistorySavedRef.current) {
      callHistorySavedRef.current = true;
      const connectedAt = callConnectedAtRef.current;
      const item: CallHistoryItem = {
        id: callId, peerName: callPeerNameRef.current || 'AYTAR üyesi', mode: callModeRef.current,
        direction: callDirectionRef.current, result: result ?? (connectedAt ? 'completed' : 'cancelled'),
        startedAt: new Date(callCreatedAtRef.current).toISOString(),
        duration: connectedAt ? Math.max(0, Math.floor((Date.now() - connectedAt) / 1000)) : 0
      };
      setCallHistory(current => [item, ...current].slice(0, 50));
    }
    if (disconnectTimerRef.current !== null) window.clearTimeout(disconnectTimerRef.current);
    disconnectTimerRef.current = null;
    callCreatedAtRef.current = null;
    callConnectedAtRef.current = null;
    setElapsedSeconds(0);
    const pc = peerConnectionRef.current;
    if (pc) {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.close();
    }
    peerConnectionRef.current = null;
    localStreamRef.current?.getTracks().forEach(track => track.stop());
    localStreamRef.current = null;
    remoteStreamRef.current?.getTracks().forEach(track => track.stop());
    remoteStreamRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    incomingCallRef.current = null;
    pendingIceRef.current = [];
    pendingLocalIceRef.current = [];
    localIceReadyRef.current = true;
    callIdRef.current = null;
    callPeerRef.current = null;
    setMicEnabled(true);
    setCameraEnabled(true);
    updateCallStatus('idle');
  }, []);

  const createPeerConnection = useCallback((peerId: string, callId: string, mode: CallKind) => {
    if (!userId) throw new Error('Oturum bulunamadı.');
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS, iceCandidatePoolSize: 4 });
    peerConnectionRef.current = pc;
    pc.onicecandidate = event => {
      if (event.candidate) {
        const candidate = event.candidate.toJSON();
        if (!localIceReadyRef.current) {
          pendingLocalIceRef.current.push(candidate);
          return;
        }
        void sendSignal(peerId, callId, 'ice', candidate as unknown as Record<string, unknown>).catch(error =>
          onNotice({ kind: 'error', text: `Bağlantı adayı gönderilemedi: ${error instanceof Error ? error.message : String(error)}` })
        );
      }
    };
    pc.ontrack = event => {
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      remoteStreamRef.current = stream;
      setRemoteStream(stream);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        if (disconnectTimerRef.current !== null) window.clearTimeout(disconnectTimerRef.current);
        disconnectTimerRef.current = null;
        if (!callConnectedAtRef.current) callConnectedAtRef.current = Date.now();
        updateCallStatus('active');
      } else if (pc.connectionState === 'disconnected') {
        onNotice({ kind: 'info', text: 'Bağlantı geçici olarak kesildi. 15 saniye boyunca yeniden bağlanma bekleniyor.' });
        if (disconnectTimerRef.current !== null) window.clearTimeout(disconnectTimerRef.current);
        disconnectTimerRef.current = window.setTimeout(() => {
          if (peerConnectionRef.current?.connectionState === 'disconnected') {
            onNotice({ kind: 'error', text: 'Bağlantı 15 saniye içinde geri gelmedi. Görüşme sonlandırıldı.' });
            closeCallMedia('failed');
          }
        }, 15000);
      } else if (pc.connectionState === 'failed') {
        onNotice({ kind: 'error', text: 'Arama bağlantısı başarısız oldu. Ağınız TURN bağlantısı gerektiriyor olabilir.' });
        closeCallMedia('failed');
      }
    };
    callIdRef.current = callId;
    callPeerRef.current = peerId;
    setCallMode(mode);
    return pc;
  }, [userId, sendSignal, onNotice, closeCallMedia]);

  const getLocalMedia = useCallback(async (mode: CallKind) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Tarayıcı mikrofon/kamera erişimini desteklemiyor. HTTPS veya localhost kullanın.');
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: mode === 'video' ? { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } : false
    });
    localStreamRef.current = stream;
    setLocalStream(stream);
    setMicEnabled(true);
    setCameraEnabled(true);
    return stream;
  }, []);

  const startCall = useCallback(async (mode: CallKind) => {
    if (!selected || !userId || !supabase || callStatusRef.current !== 'idle') return;
    if (!signalingReadyRef.current) {
      onNotice({ kind: 'info', text: 'Arama servisi bağlanıyor, bir saniye sonra tekrar dene.' });
      return;
    }
    try {
      updateCallStatus('calling');
      callCreatedAtRef.current = Date.now();
      callConnectedAtRef.current = null;
      callDirectionRef.current = 'outgoing';
      callHistorySavedRef.current = false;
      setCallPeerName(selected.username);
      callPeerNameRef.current = selected.username;
      setCallMode(mode);
      callModeRef.current = mode;
      const callId = crypto.randomUUID();
      callIdRef.current = callId;
      callPeerRef.current = selected.user_id;
      const stream = await getLocalMedia(mode);
      localIceReadyRef.current = false;
      const pc = createPeerConnection(selected.user_id, callId, mode);
      stream.getTracks().forEach(track => pc.addTrack(track, stream));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await sendSignal(selected.user_id, callId, 'offer', {
        description: pc.localDescription?.toJSON(), mode, callerName: profile?.username || 'AYTAR üyesi'
      });
      localIceReadyRef.current = true;
      const queuedIce = pendingLocalIceRef.current.splice(0);
      for (const candidate of queuedIce) {
        await sendSignal(selected.user_id, callId, 'ice', candidate as unknown as Record<string, unknown>);
      }
    } catch (error) {
      closeCallMedia('failed');
      onNotice({ kind: 'error', text: `Arama başlatılamadı: ${error instanceof Error ? error.message : String(error)}` });
    }
  }, [selected, userId, getLocalMedia, createPeerConnection, sendSignal, closeCallMedia, onNotice, profile?.username]);

  const acceptCall = useCallback(async () => {
    const incoming = incomingCallRef.current;
    if (!incoming || callStatusRef.current !== 'ringing') return;
    try {
      const stream = await getLocalMedia(incoming.mode);
      localIceReadyRef.current = true;
      const pc = createPeerConnection(incoming.peerId, incoming.callId, incoming.mode);
      await pc.setRemoteDescription(new RTCSessionDescription(incoming.offer));
      await flushPendingIce(pc);
      stream.getTracks().forEach(track => pc.addTrack(track, stream));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      updateCallStatus('connecting');
      await sendSignal(incoming.peerId, incoming.callId, 'answer', { description: pc.localDescription?.toJSON() });
      incomingCallRef.current = null;
    } catch (error) {
      onNotice({ kind: 'error', text: `Arama kabul edilemedi: ${error instanceof Error ? error.message : String(error)}` });
      closeCallMedia('failed');
    }
  }, [getLocalMedia, createPeerConnection, flushPendingIce, sendSignal, onNotice, closeCallMedia]);

  const rejectCall = useCallback(async () => {
    const incoming = incomingCallRef.current;
    if (incoming) {
      try { await sendSignal(incoming.peerId, incoming.callId, 'reject'); } catch (error) {
        console.warn('[AYTAR ARAMA] Reddetme sinyali gönderilemedi:', error);
      }
    }
    closeCallMedia('rejected');
  }, [sendSignal, closeCallMedia]);

  const endCall = useCallback(async () => {
    const peerId = callPeerRef.current;
    const callId = callIdRef.current;
    if (peerId && callId) {
      try { await sendSignal(peerId, callId, 'hangup'); } catch (error) {
        console.warn('[AYTAR ARAMA] Bitirme sinyali gönderilemedi:', error);
      }
    }
    closeCallMedia();
  }, [sendSignal, closeCallMedia]);

  // Listen for calls even while the communication panel is closed.
  useEffect(() => {
    if (!active || !supabase || !userId) return;
    let disposed = false;
    const channel = supabase.channel(`aytar-call-signals:${userId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'aytar_call_signals',
        filter: `recipient_id=eq.${userId}`
      }, payload => {
        const signal = payload.new as CallSignal;
        if (disposed || seenSignalIdsRef.current.has(signal.id)) return;
        seenSignalIdsRef.current.add(signal.id);
        if (seenSignalIdsRef.current.size > 500) seenSignalIdsRef.current.clear();

        if (signal.kind === 'offer') {
          if (callStatusRef.current !== 'idle') {
            void sendSignal(signal.sender_id, signal.call_id, 'reject').catch(() => undefined);
            return;
          }
          const description = signal.payload.description as RTCSessionDescriptionInit | undefined;
          if (!description) return;
          const mode = signal.payload.mode === 'video' ? 'video' : 'audio';
          const incoming: IncomingCall = {
            callId: signal.call_id, peerId: signal.sender_id,
            peerName: typeof signal.payload.callerName === 'string' ? signal.payload.callerName : 'AYTAR üyesi',
            mode, offer: description
          };
          incomingCallRef.current = incoming;
          callCreatedAtRef.current = Date.now();
          callConnectedAtRef.current = null;
          callDirectionRef.current = 'incoming';
          callHistorySavedRef.current = false;
          callIdRef.current = incoming.callId;
          callPeerRef.current = incoming.peerId;
          setCallPeerName(incoming.peerName);
          callPeerNameRef.current = incoming.peerName;
          setCallMode(mode);
          callModeRef.current = mode;
          updateCallStatus('ringing');
          return;
        }

        if (signal.call_id !== callIdRef.current) return;
        if (signal.kind === 'answer') {
          const pc = peerConnectionRef.current;
          const description = signal.payload.description as RTCSessionDescriptionInit | undefined;
          if (pc && description) {
            void pc.setRemoteDescription(new RTCSessionDescription(description))
              .then(() => flushPendingIce(pc))
              .then(() => updateCallStatus('connecting'))
              .catch(error => onNotice({ kind: 'error', text: `Arama yanıtı işlenemedi: ${String(error)}` }));
          }
        } else if (signal.kind === 'ice') {
          const candidate = signal.payload as unknown as RTCIceCandidateInit;
          const pc = peerConnectionRef.current;
          if (!candidate.candidate) return;
          if (pc?.remoteDescription) {
            void pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(error =>
              console.warn('[AYTAR ARAMA] ICE adayı eklenemedi:', error)
            );
          } else pendingIceRef.current.push(candidate);
        } else if (signal.kind === 'reject') {
          closeCallMedia('rejected');
          onNotice({ kind: 'info', text: 'Karşı taraf aramayı reddetti.' });
        } else if (signal.kind === 'hangup') {
          closeCallMedia();
          onNotice({ kind: 'info', text: 'Karşı taraf görüşmeyi bitirdi.' });
        }
      })
      .subscribe(status => {
        const ready = status === 'SUBSCRIBED';
        signalingReadyRef.current = ready;
        if (!disposed) setSignalingReady(ready);
        // Recover a still-ringing offer after the app wakes from a push notification.
        if (ready) {
          void supabase!.from('aytar_call_signals').select('*')
            .eq('recipient_id', userId).eq('kind', 'offer')
            .gte('created_at', new Date(Date.now() - 45000).toISOString())
            .order('created_at', { ascending: false }).limit(1)
            .then(({ data, error }) => {
              if (disposed || error || !data?.length || callStatusRef.current !== 'idle') return;
              const signal = data[0] as CallSignal;
              if (seenSignalIdsRef.current.has(signal.id)) return;
              seenSignalIdsRef.current.add(signal.id);
              const description = signal.payload.description as RTCSessionDescriptionInit | undefined;
              if (!description) return;
              const mode = signal.payload.mode === 'video' ? 'video' : 'audio';
              const incoming: IncomingCall = {
                callId: signal.call_id, peerId: signal.sender_id,
                peerName: typeof signal.payload.callerName === 'string' ? signal.payload.callerName : 'AYTAR üyesi',
                mode, offer: description
              };
              incomingCallRef.current = incoming;
              callCreatedAtRef.current = Date.now();
              callConnectedAtRef.current = null;
              callDirectionRef.current = 'incoming';
              callHistorySavedRef.current = false;
              callIdRef.current = incoming.callId;
              callPeerRef.current = incoming.peerId;
              setCallPeerName(incoming.peerName);
              callPeerNameRef.current = incoming.peerName;
              setCallMode(mode);
              callModeRef.current = mode;
              updateCallStatus('ringing');
            });
        }
      });
    return () => {
      disposed = true;
      signalingReadyRef.current = false;
      setSignalingReady(false);
      void supabase!.removeChannel(channel);
      closeCallMedia();
    };
  }, [active, userId, sendSignal, flushPendingIce, closeCallMedia, onNotice]);

  useEffect(() => {
    try { localStorage.setItem('aytar-call-history-v1', JSON.stringify(callHistory)); }
    catch (error) { console.warn('[AYTAR ARAMA] Arama geçmişi kaydedilemedi:', error); }
  }, [callHistory]);

  useEffect(() => {
    if (callStatus !== 'calling' && callStatus !== 'ringing') return;
    const timeout = window.setTimeout(() => {
      const peerId = callPeerRef.current;
      const callId = callIdRef.current;
      if (peerId && callId) void sendSignal(peerId, callId, callStatus === 'ringing' ? 'reject' : 'hangup').catch(() => undefined);
      onNotice({ kind: 'info', text: callStatus === 'ringing' ? 'Cevapsız arama.' : 'Arama zaman aşımına uğradı.' });
      closeCallMedia(callStatus === 'ringing' ? 'missed' : 'cancelled');
    }, 45000);
    return () => window.clearTimeout(timeout);
  }, [callStatus, sendSignal, closeCallMedia, onNotice]);

  useEffect(() => {
    if (callStatus !== 'active' || !callConnectedAtRef.current) return;
    const update = () => setElapsedSeconds(Math.floor((Date.now() - (callConnectedAtRef.current || Date.now())) / 1000));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [callStatus]);

  useEffect(() => {
    if (callStatus !== 'calling' && callStatus !== 'ringing') return;
    let audioContext: AudioContext | null = null;
    let interval: number | null = null;
    const beep = () => {
      try {
        audioContext ||= new AudioContext();
        if (audioContext.state === 'suspended') void audioContext.resume();
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = callStatus === 'ringing' ? 660 : 480;
        gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.055, audioContext.currentTime + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.28);
        oscillator.connect(gain); gain.connect(audioContext.destination);
        oscillator.start(); oscillator.stop(audioContext.currentTime + 0.3);
      } catch (error) { console.debug('[AYTAR ARAMA] Zil sesi kullanılamıyor:', error); }
    };
    beep();
    interval = window.setInterval(beep, callStatus === 'ringing' ? 1500 : 2400);
    return () => { if (interval !== null) window.clearInterval(interval); if (audioContext) void audioContext.close(); };
  }, [callStatus]);

  useEffect(() => {
    if (localVideoRef.current && localStream) localVideoRef.current.srcObject = localStream;
  }, [localStream, callStatus]);
  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) remoteVideoRef.current.srcObject = remoteStream;
  }, [remoteStream, callStatus]);

  // Refresh online members while the panel is visible.
  useEffect(() => {
    if (!open || !active || !supabase) return;
    void loadMembers();
    const channel = supabase.channel('aytar-communication-presence-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'aytar_presence' }, () => void loadMembers())
      .subscribe();
    return () => { void supabase!.removeChannel(channel); };
  }, [open, active, loadMembers]);

  // Build one conversation row per person from the current user's message history.
  useEffect(() => {
    if (!open || tab !== 'chats' || !userId || !supabase) return;
    let disposed = false;
    const loadChats = async () => {
      setLoadingChats(true);
      const { data, error } = await supabase!
        .from('aytar_direct_messages')
        .select('id,sender_id,recipient_id,body,created_at')
        .or(`sender_id.eq.${userId},recipient_id.eq.${userId}`)
        .order('created_at', { ascending: false }).limit(5000);
      if (disposed) return;
      if (error) {
        onNotice({ kind: 'error', text: `Sohbetler y\u00fcklenemedi: ${error.message}` });
        setChats([]); setLoadingChats(false); return;
      }
      const latestByPeer = new Map<string, DirectMessage>();
      for (const message of (data ?? []) as DirectMessage[]) {
        const peerId = message.sender_id === userId ? message.recipient_id : message.sender_id;
        if (peerId && !latestByPeer.has(peerId)) latestByPeer.set(peerId, message);
      }
      const peerIds = [...latestByPeer.keys()];
      if (peerIds.length === 0) { setChats([]); setLoadingChats(false); return; }
      const { data: profilesData, error: profilesError } = await supabase!
        .from('profiles').select('id,username').in('id', peerIds);
      if (disposed) return;
      if (profilesError) onNotice({ kind: 'error', text: `Sohbet \u00fcyeleri al\u0131namad\u0131: ${profilesError.message}` });
      const usernames = new Map((profilesData ?? []).map((item: { id: string; username: string | null }) => [item.id, item.username]));
      setChats(peerIds.map(peerId => ({
        member: { user_id: peerId, username: usernames.get(peerId) || 'AYTAR \u00fcyesi', last_seen_at: '' },
        lastMessage: latestByPeer.get(peerId)!
      })));
      setLoadingChats(false);
    };
    void loadChats();
    return () => { disposed = true; };
  }, [open, tab, userId, onNotice]);

  useEffect(() => {
    if (!open || !selected || !userId || !supabase) return;
    let disposed = false;
    const load = async () => {
      setLoadingMessages(true);
      const { data, error } = await supabase!
        .from('aytar_direct_messages')
        .select('id,sender_id,recipient_id,body,created_at')
        .or(`and(sender_id.eq.${userId},recipient_id.eq.${selected.user_id}),and(sender_id.eq.${selected.user_id},recipient_id.eq.${userId})`)
        .order('created_at', { ascending: true }).limit(200);
      if (!disposed) {
        if (error) onNotice({ kind: 'error', text: `Mesajlar yüklenemedi: ${error.message}` });
        else setMessages((data ?? []) as DirectMessage[]);
        setLoadingMessages(false);
      }
    };
    void load();
    const channel = supabase.channel(`aytar-dm-${[userId, selected.user_id].sort().join('-')}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'aytar_direct_messages' }, payload => {
        const row = payload.new as DirectMessage;
        const belongs = (row.sender_id === userId && row.recipient_id === selected.user_id)
          || (row.sender_id === selected.user_id && row.recipient_id === userId);
        if (belongs) setMessages(current => current.some(item => item.id === row.id) ? current : [...current, row]);
      }).subscribe();
    return () => { disposed = true; void supabase!.removeChannel(channel); };
  }, [open, selected?.user_id, userId, onNotice]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  const sendMessage = async (event: React.FormEvent) => {
    event.preventDefault();
    const body = draft.trim();
    if (!supabase || !userId || !selected || !body || sending) return;
    setSending(true);
    const { data, error } = await supabase.from('aytar_direct_messages')
      .insert({ sender_id: userId, recipient_id: selected.user_id, body })
      .select('id,sender_id,recipient_id,body,created_at').single();
    if (error) onNotice({ kind: 'error', text: `Mesaj gönderilemedi: ${error.message}` });
    else {
      setDraft('');
      if (data) setMessages(current => current.some(item => item.id === data.id) ? current : [...current, data as DirectMessage]);
    }
    setSending(false);
  };

  const openPanel = () => {
    if (!userId) { onAuthRequired(); return; }
    if (profile?.status !== 'active') {
      onNotice({ kind: 'info', text: 'İletişim Merkezi yalnızca aktif üyelere açıktır.' });
      return;
    }
    setOpen(value => !value);
    setSelected(null);
    setTab('members');
  };

  const toggleMic = () => {
    const next = !micEnabled;
    localStreamRef.current?.getAudioTracks().forEach(track => { track.enabled = next; });
    setMicEnabled(next);
  };
  const toggleCamera = () => {
    const next = !cameraEnabled;
    localStreamRef.current?.getVideoTracks().forEach(track => { track.enabled = next; });
    setCameraEnabled(next);
  };

  const filteredMembers = members.filter(member => member.username.toLocaleLowerCase('tr').includes(search.toLocaleLowerCase('tr')));
  const initials = (name: string) => name.trim().slice(0, 1).toLocaleUpperCase('tr') || 'Ü';
  const callLabel = callStatus === 'calling' ? 'Aranıyor…' : callStatus === 'ringing' ? 'Gelen arama' : callStatus === 'connecting' ? 'Bağlanıyor…' : 'Görüşme sürüyor';
  const formatDuration = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;

  return (
    <>
      <button type="button" className={`aytar-communication-button ${open ? 'is-active' : ''}`}
        onClick={openPanel} title="AYTAR İletişim Merkezi" aria-label="AYTAR İletişim Merkezi">
        <Video size={17} />
        {active && members.length > 0 && <span className="aytar-communication-count">{members.length}</span>}
      </button>

      {open && active && (
        <section className="aytar-communication-panel" role="dialog" aria-label="AYTAR İletişim Merkezi">
          <header className="aytar-communication-head">
            <div className="aytar-communication-brand"><span className="aytar-communication-mark"><MessagesSquare size={18} /></span>
              <div><strong>AYTAR İLETİŞİM</strong><small>{signalingReady ? 'Topluluk bağlantıda' : 'Bağlantı kuruluyor…'}</small></div>
            </div>
            <button type="button" className="aytar-communication-close" onClick={() => { setOpen(false); setSelected(null); }} aria-label="Kapat"><X size={18} /></button>
          </header>

          <nav className="aytar-communication-tabs">
            <button className={tab === 'members' ? 'active' : ''} onClick={() => { setTab('members'); setSelected(null); }}><Users size={15} /> Üyeler</button>
            <button className={tab === 'chats' ? 'active' : ''} onClick={() => { setTab('chats'); setSelected(null); }}><MessageCircle size={15} /> Sohbetler</button>
            <button className={tab === 'meetings' ? 'active' : ''} onClick={() => { setTab('meetings'); setSelected(null); }}><Video size={15} /> Toplantı</button>
            <button className={tab === 'calls' ? 'active' : ''} onClick={() => { setTab('calls'); setSelected(null); }}><Phone size={15} /> Aramalar</button>
          </nav>

          {selected ? (
            <div className="aytar-communication-chat">
              <div className="aytar-communication-chathead">
                <button type="button" onClick={() => setSelected(null)} aria-label="Üyelere dön"><ArrowLeft size={17} /></button>
                <span className="aytar-communication-avatar">{initials(selected.username)}</span>
                <div><strong>{selected.username}</strong><small><i /> Çevrimiçi</small></div>
                <button type="button" className="aytar-communication-call" title="Sesli ara" onClick={() => void startCall('audio')} disabled={callStatus !== 'idle'}><Phone size={16} /></button>
                <button type="button" className="aytar-communication-call" title="Görüntülü ara" onClick={() => void startCall('video')} disabled={callStatus !== 'idle'}><Video size={16} /></button>
              </div>
              <div className="aytar-communication-messages">
                {loadingMessages ? <div className="aytar-communication-empty"><LoaderCircle className="gps-spinner" /> Mesajlar yükleniyor...</div>
                  : messages.length === 0 ? <div className="aytar-communication-empty">Henüz mesaj yok.<br />İlk mesajı sen gönder.</div>
                  : messages.map(message => <div key={message.id} className={`aytar-message-row ${message.sender_id === userId ? 'mine' : 'theirs'}`}>
                    <p>{message.body}</p><time>{new Date(message.created_at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</time>
                  </div>)}
                <div ref={bottomRef} />
              </div>
              <form className="aytar-communication-compose" onSubmit={sendMessage}>
                <textarea value={draft} onChange={event => setDraft(event.target.value)} placeholder="Mesaj yaz..." maxLength={4000} rows={1} />
                <button type="submit" disabled={!draft.trim() || sending} aria-label="Mesaj gönder">{sending ? <LoaderCircle className="gps-spinner" size={17} /> : <Send size={17} />}</button>
              </form>
            </div>
          ) : tab === 'members' ? (
            <div className="aytar-communication-members">
              <div className="aytar-communication-search"><Search size={16} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Üye ara..." /></div>
              <div className="aytar-communication-sectionlabel"><span>ÇEVRİMİÇİ ÜYELER</span><b>{members.length}</b></div>
              {loadingMembers && members.length === 0 ? <div className="aytar-communication-empty"><LoaderCircle className="gps-spinner" /> Üyeler yükleniyor...</div>
                : filteredMembers.length === 0 ? <div className="aytar-communication-empty">Şu anda başka çevrimiçi aktif üye yok.</div>
                : filteredMembers.map(member => <button type="button" key={member.user_id} className="aytar-communication-member" onClick={() => { setSelected(member); setMessages([]); }}>
                  <span className="aytar-communication-avatar">{initials(member.username)}</span>
                  <span className="aytar-communication-memberinfo"><strong>{member.username}</strong><small><Circle size={8} fill="currentColor" /> Çevrimiçi</small></span>
                  <MessageCircle size={17} />
                </button>)}
            </div>
           ) : tab === 'chats' ? (
            <div className="aytar-communication-members">
              {loadingChats ? <div className="aytar-communication-empty"><LoaderCircle className="gps-spinner" /> Sohbetler y\u00fckleniyor...</div>
                : chats.length === 0 ? <div className="aytar-communication-empty aytar-communication-empty-tall">Hen\u00fcz sohbet ge\u00e7mi\u015fin yok.</div>
                : chats.map(chat => <button type="button" key={chat.member.user_id} className="aytar-communication-member" onClick={() => { setSelected(chat.member); setMessages([]); }}>
                  <span className="aytar-communication-avatar">{initials(chat.member.username)}</span>
                  <span className="aytar-communication-memberinfo"><strong>{chat.member.username}</strong><small>{chat.lastMessage.body}</small></span>
                  <time>{new Date(chat.lastMessage.created_at).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' })}</time>
                </button>)}
            </div>
) : tab === 'calls' ? (
            <div className="aytar-call-history">
              <div className="aytar-call-history-title"><strong>Son aramalar</strong><button type="button" onClick={() => setCallHistory([])} disabled={callHistory.length === 0}>Temizle</button></div>
              {callHistory.length === 0 ? <div className="aytar-communication-empty">Henüz arama geçmişi yok.</div> : callHistory.map(item => (
                <div className="aytar-call-history-item" key={item.id}>
                  <span className={`history-icon ${item.direction}`}><Phone size={15} /></span>
                  <div><strong>{item.peerName}</strong><small>{item.direction === 'incoming' ? 'Gelen' : 'Giden'} · {item.mode === 'video' ? 'Görüntülü' : 'Sesli'} · {new Date(item.startedAt).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</small></div>
                  <span className={`history-result ${item.result}`}>{item.result === 'completed' ? formatDuration(item.duration) : item.result === 'missed' ? 'Cevapsız' : item.result === 'rejected' ? 'Reddedildi' : item.result === 'cancelled' ? 'İptal' : 'Başarısız'}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="aytar-communication-meetings">
              <span className="aytar-communication-meetingicon"><Video size={24} /></span>
              <strong>AYTAR Toplantı Odaları</strong>
              <p>Şimdilik birebir sesli ve görüntülü aramalar etkin. Çok katılımcılı toplantı odaları sonraki aşamada eklenecek.</p>
              <small>{signalingReady ? 'Arama servisi hazır' : 'Arama servisine bağlanılıyor'}</small>
            </div>
          )}
        </section>
      )}

      {active && callStatus !== 'idle' && (
        <div className="aytar-call-backdrop" role="dialog" aria-label="AYTAR arama penceresi">
          <section className={`aytar-call-window ${callMode === 'audio' ? 'audio-mode' : ''}`}>
            <header className="aytar-call-header">
              <div><strong>{callMode === 'video' ? 'Görüntülü arama' : 'Sesli arama'}</strong><small>{callLabel} · {callPeerName}{callStatus === 'active' ? ` · ${formatDuration(elapsedSeconds)}` : ''}</small></div>
              <span className={`aytar-call-status ${callStatus}`} />
            </header>
            <div className="aytar-call-stage">
              <video ref={remoteVideoRef} autoPlay playsInline className={callMode === 'audio' ? 'aytar-remote-video audio-only' : 'aytar-remote-video'} />
              {callMode === 'audio' && <div className="aytar-audio-avatar"><MessagesSquare size={34} /><strong>{callPeerName}</strong><small>{callLabel}</small></div>}
              {callMode === 'video' && localStream && <video ref={localVideoRef} autoPlay muted playsInline className="aytar-local-video" />}
              {callStatus === 'calling' && <div className="aytar-call-overlay-text">Karşı tarafın yanıtı bekleniyor…</div>}
              {callStatus === 'connecting' && <div className="aytar-call-overlay-text">Güvenli bağlantı kuruluyor…</div>}
              {callStatus === 'ringing' && <div className="aytar-incoming-actions">
                <strong>{callPeerName} seni arıyor</strong>
                <div><button type="button" className="accept" onClick={() => void acceptCall()}><PhoneCall size={19} /> Kabul et</button>
                  <button type="button" className="decline" onClick={() => void rejectCall()}><PhoneOff size={19} /> Reddet</button></div>
              </div>}
            </div>
            <footer className="aytar-call-controls">
              {callStatus !== 'ringing' && <>
                <button type="button" className={!micEnabled ? 'off' : ''} onClick={toggleMic} title={micEnabled ? 'Mikrofonu kapat' : 'Mikrofonu aç'}><>{micEnabled ? <Mic size={18} /> : <MicOff size={18} />}</></button>
                {callMode === 'video' && <button type="button" className={!cameraEnabled ? 'off' : ''} onClick={toggleCamera} title={cameraEnabled ? 'Kamerayı kapat' : 'Kamerayı aç'}>{cameraEnabled ? <Camera size={18} /> : <CameraOff size={18} />}</button>}
              </>}
              <button type="button" className="hangup" onClick={() => void endCall()} title="Görüşmeyi bitir" aria-label="Görüşmeyi bitir"><PhoneOff size={19} /><span>Bitir</span></button>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
