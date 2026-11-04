import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';

type LoadPinsOptions = boolean | { silent?: boolean; incremental?: boolean };
type LoadPins = (options?: LoadPinsOptions) => Promise<void>;

type UsePinsRealtimeOptions = {
  userId?: string;
  loadPins: LoadPins;
};

export function usePinsRealtime({ userId, loadPins }: UsePinsRealtimeOptions): void {
  const loadPinsRef = useRef(loadPins);

  useEffect(() => {
    loadPinsRef.current = loadPins;
  }, [loadPins]);

  useEffect(() => {
    if (!userId || !supabase) return;

    let disposed = false;
    let fallbackId: number | null = null;
    let refreshInFlight = false;
    let refreshQueued = false;

    const refreshPins = async () => {
      if (disposed) return;
      if (refreshInFlight) {
        refreshQueued = true;
        return;
      }
      refreshInFlight = true;
      try {
        do {
          refreshQueued = false;
          await loadPinsRef.current({ silent: true, incremental: true });
        } while (refreshQueued && !disposed);
      } finally {
        refreshInFlight = false;
      }
    };

    const stopFallback = () => {
      if (fallbackId !== null) {
        window.clearInterval(fallbackId);
        fallbackId = null;
      }
    };

    const startFallback = () => {
      if (disposed || fallbackId !== null) return;
      fallbackId = window.setInterval(() => {
        if (document.visibilityState === 'visible') void refreshPins();
      }, 10000);
    };

    const channel = supabase
      .channel('pins-insert-refresh')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pins' }, () => {
        void refreshPins();
      })
      .subscribe(status => {
        if (disposed) return;
        if (status === 'SUBSCRIBED') {
          stopFallback();
          void refreshPins();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          startFallback();
        }
      });

    return () => {
      disposed = true;
      stopFallback();
      void supabase?.removeChannel(channel);
    };
  }, [userId]);
}
