import { useEffect, useState } from 'react';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

export type LiveSignal = {
  type: 'viewer-join' | 'offer' | 'answer' | 'ice' | 'viewer-left' | 'session-ended';
  from: string;
  to?: string;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};

const rtcConfig: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

async function sendSignal(channel: RealtimeChannel, payload: LiveSignal) {
  await channel.send({ type: 'broadcast', event: 'signal', payload });
}

export function useBroadcast(
  supabase: SupabaseClient | null,
  roomId: string | null,
  publisherId: string | null,
  stream: MediaStream | null,
) {
  const [status, setStatus] = useState('Yayın bağlantısı bekleniyor');

  useEffect(() => {
    if (!supabase || !roomId || !publisherId || !stream) return;
    let disposed = false;
    const peers = new Map<string, RTCPeerConnection>();
    const pendingIce = new Map<string, RTCIceCandidateInit[]>();
    const channel = supabase.channel(`room:${roomId}`, {
      config: { private: false, broadcast: { self: false, ack: true } },
    });

    const closePeer = (id: string) => {
      peers.get(id)?.close();
      peers.delete(id);
      pendingIce.delete(id);
    };

    const createPeer = async (viewerId: string) => {
      if (disposed || peers.has(viewerId)) return;
      const pc = new RTCPeerConnection(rtcConfig);
      peers.set(viewerId, pc);
      stream.getTracks().forEach(track => pc.addTrack(track, stream));
      pc.onicecandidate = event => {
        if (event.candidate) void sendSignal(channel, {
          type: 'ice', from: publisherId, to: viewerId, candidate: event.candidate.toJSON(),
        });
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') setStatus('YAYIN AKTİF · İZLEYİCİ BAĞLANDI');
        if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) closePeer(viewerId);
      };
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await sendSignal(channel, {
        type: 'offer', from: publisherId, to: viewerId, sdp: pc.localDescription ?? offer,
      });
    };

    channel.on('broadcast', { event: 'signal' }, ({ payload }) => {
      const message = payload as LiveSignal;
      if (!message || message.from === publisherId || (message.to && message.to !== publisherId)) return;
      if (message.type === 'viewer-join') {
        void createPeer(message.from).catch(() => setStatus('İzleyici bağlantısı kurulamadı'));
      } else if (message.type === 'answer') {
        const pc = peers.get(message.from);
        if (pc && message.sdp) {
          void pc.setRemoteDescription(message.sdp).then(async () => {
            const queued = pendingIce.get(message.from) ?? [];
            pendingIce.delete(message.from);
            for (const candidate of queued) await pc.addIceCandidate(candidate).catch(() => undefined);
          }).catch(() => closePeer(message.from));
        }
      } else if (message.type === 'ice' && message.candidate) {
        const pc = peers.get(message.from);
        if (pc?.remoteDescription) void pc.addIceCandidate(message.candidate).catch(() => undefined);
        else pendingIce.set(message.from, [...(pendingIce.get(message.from) ?? []), message.candidate]);
      } else if (message.type === 'viewer-left') {
        closePeer(message.from);
      }
    });

    void channel.subscribe(state => {
      if (state === 'SUBSCRIBED') setStatus('CANLI · İZLEYİCİ BEKLENİYOR');
      if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') setStatus('Realtime signaling bağlantı hatası');
    });

    return () => {
      disposed = true;
      peers.forEach(peer => peer.close());
      peers.clear();
      void supabase.removeChannel(channel);
    };
  }, [supabase, roomId, publisherId, stream]);

  return { status, localStream: stream };
}

export function useViewer(
  supabase: SupabaseClient | null,
  roomId: string | null,
  viewerId: string | null,
) {
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState('Yayın bağlantısı bekleniyor');

  useEffect(() => {
    if (!supabase || !roomId || !viewerId) return;
    let pc: RTCPeerConnection | null = null;
    let disposed = false;
    const pendingIce: RTCIceCandidateInit[] = [];
    const channel = supabase.channel(`room:${roomId}`, {
      config: { private: true, broadcast: { self: false, ack: true } },
    });
    const send = (payload: LiveSignal) => sendSignal(channel, payload);

    channel.on('broadcast', { event: 'signal' }, async ({ payload }) => {
      const message = payload as LiveSignal;
      if (!message || message.to !== viewerId || disposed) return;
      if (message.type === 'offer' && message.sdp) {
        pc?.close();
        pc = new RTCPeerConnection(rtcConfig);
        pc.addTransceiver('video', { direction: 'recvonly' });
        pc.addTransceiver('audio', { direction: 'recvonly' });
        pc.ontrack = event => {
          const stream = event.streams[0] ?? new MediaStream([event.track]);
          event.track.onended = () => setStatus('Yayın sona erdi');
          setRemoteStream(stream);
          setStatus('CANLI YAYIN');
        };
        pc.onicecandidate = event => {
          if (event.candidate) void send({
            type: 'ice', from: viewerId, to: message.from, candidate: event.candidate.toJSON(),
          });
        };
        pc.onconnectionstatechange = () => {
          if (pc?.connectionState === 'failed') setStatus('P2P bağlantısı kurulamadı');
        };
        await pc.setRemoteDescription(message.sdp);
        for (const candidate of pendingIce.splice(0)) {
          await pc.addIceCandidate(candidate).catch(() => undefined);
        }
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await send({ type: 'answer', from: viewerId, to: message.from, sdp: pc.localDescription ?? answer });
      } else if (message.type === 'ice' && message.candidate) {
        if (pc?.remoteDescription) await pc.addIceCandidate(message.candidate).catch(() => undefined);
        else pendingIce.push(message.candidate);
      } else if (message.type === 'session-ended') {
        setStatus('Yayın sona erdi');
        setRemoteStream(null);
        pc?.close();
      }
    });

    void channel.subscribe(async state => {
      if (state === 'SUBSCRIBED') {
        setStatus('Yayıncıya bağlanılıyor');
        await send({ type: 'viewer-join', from: viewerId });
      }
      if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') setStatus('Realtime signaling bağlantı hatası');
    });

    return () => {
      disposed = true;
      pc?.close();
      setRemoteStream(null);
      void send({ type: 'viewer-left', from: viewerId }).catch(() => undefined);
      void supabase.removeChannel(channel);
    };
  }, [supabase, roomId, viewerId]);

  return { remoteStream, status };
}
