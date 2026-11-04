import { useCallback, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { supabase } from '../lib/supabase';

export type PinPhoto = { id: string; storage_path: string; public_url: string; sort_order: number };
type PinVote = { vote_type: number; user_id: string };
export type Pin = {
  id: string;
  owner_id: string;
  lat: number;
  lng: number;
  description: string;
  created_at: string;
  category: string | null;
  voice_note_url?: string | null;
  pin_photos: PinPhoto[];
  pin_votes: PinVote[];
};

type RouteInfo = { distance: string; duration: string; pinsOnRoute: string[] };
type LoadPinsOptions = boolean | { silent?: boolean; incremental?: boolean };

type UsePinsOptions = {
  canSeePins: boolean;
  selected: Pin | null;
  setSelected: Dispatch<SetStateAction<Pin | null>>;
  setSearchResultIds: Dispatch<SetStateAction<string[] | null>>;
  selectedCategoryFilter: string;
  timeFilter: string;
  userId?: string;
  debouncedQuery: string;
  searchResultIds: string[] | null;
  routeInfo: RouteInfo | null;
  viewportBounds: [number, number, number, number] | null;
  onError: (message: string) => void;
};

function normalizePinCategory(category?: string | null): string {
  switch (category) {
    case 'YEŞİL': case 'Yeşiller': case 'Yeşil': return 'YEŞİL';
    case 'MAVİ': case 'Maviler': case 'Mavi': return 'MAVİ';
    case 'GRİ': case 'SARI': case 'Siviller': case 'Sivil': case 'Sarı': case 'Sarılar': return 'SARI';
    case 'KIRMIZI': case 'Hepsi': case null: case undefined: return 'KIRMIZI';
    default: return 'KIRMIZI';
  }
}

export function usePins({
  canSeePins,
  selected,
  setSelected,
  setSearchResultIds,
  selectedCategoryFilter,
  timeFilter,
  userId,
  debouncedQuery,
  searchResultIds,
  routeInfo,
  viewportBounds,
  onError,
}: UsePinsOptions) {
  const [pins, setPins] = useState<Pin[]>([]);
  const lastSyncAtRef = useRef<string>('');
  const loadRequestRef = useRef(0);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const loadPins = useCallback(async (silentOrOptions: LoadPinsOptions = false) => {
    const options = typeof silentOrOptions === 'boolean'
      ? { silent: silentOrOptions, incremental: false }
      : silentOrOptions;
    const silent = options.silent === true;

    if (!supabase || !canSeePins) {
      setPins([]);
      setSelected(null);
      setSearchResultIds(null);
      return;
    }

    const requestId = ++loadRequestRef.current;
    try {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const rows: Pin[] = [];
      const pageSize = 500;
      let offset = 0;
      const incremental = !!options.incremental && !!lastSyncAtRef.current;
      const since = incremental
        ? new Date(new Date(lastSyncAtRef.current).getTime() - 2000).toISOString()
        : null;

      while (true) {
        let query = supabase
          .from('pins')
          .select('id,owner_id,lat,lng,description,category,created_at,voice_note_url,pin_photos(id,storage_path,public_url,sort_order),pin_votes(vote_type,user_id)')
          .gte('created_at', cutoff)
          .order('created_at', { ascending: false })
          .range(offset, offset + pageSize - 1);
        if (since) query = query.gt('created_at', since);

        const { data, error } = await query;
        if (error) {
          if (silent) console.warn('Pinler yüklenemedi:', error);
          else onErrorRef.current('Bağlantı sorunu yaşanıyor, lütfen tekrar deneyin.');
          return;
        }

        const batch = (data ?? []) as unknown as Pin[];
        rows.push(...batch);
        if (batch.length < pageSize) break;
        offset += batch.length;
      }

      if (requestId !== loadRequestRef.current) return;

      if (incremental) {
        setPins(current => {
          const byId = new Map(current.map(pin => [pin.id, pin]));
          for (const row of rows) {
            byId.set(row.id, {
              ...byId.get(row.id),
              ...row,
              pin_photos: row.pin_photos?.length ? row.pin_photos : (byId.get(row.id)?.pin_photos ?? []),
            });
          }
          return [...byId.values()]
            .filter(pin => pin.created_at >= cutoff)
            .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
        });
      } else {
        setPins(rows);
        setSelected(current => current && !rows.some(pin => pin.id === current.id) ? null : current);
      }

      lastSyncAtRef.current = new Date().toISOString();
    } catch (error) {
      console.warn('Pinler yüklenemedi:', error);
      if (!silent) onErrorRef.current('Bağlantı sorunu yaşanıyor, lütfen tekrar deneyin.');
    }
  }, [canSeePins, setSearchResultIds, setSelected]);

  const matchingIds = useMemo(
    () => new Set(searchResultIds ?? pins.map(pin => pin.id)),
    [searchResultIds, pins],
  );

  const filteredPins = useMemo(() => {
    const categoryPins = selectedCategoryFilter === 'Tümü'
      ? pins
      : selectedCategoryFilter === 'BENIM'
        ? (userId ? pins.filter(pin => pin.owner_id === userId) : [])
        : pins.filter(pin => normalizePinCategory(pin.category) === selectedCategoryFilter);

    if (timeFilter === 'all') return categoryPins;
    const durationByFilter: Record<string, number> = {
      '1m': 60_000,
      '15m': 15 * 60_000,
      '30m': 30 * 60_000,
      '1h': 60 * 60_000,
      '6h': 6 * 60 * 60_000,
      '12h': 12 * 60 * 60_000,
    };
    const duration = durationByFilter[timeFilter];
    if (!duration) return categoryPins;
    const now = Date.now();
    return categoryPins.filter(pin => {
      const createdAt = new Date(pin.created_at).getTime();
      const age = now - createdAt;
      return Number.isFinite(createdAt) && age >= 0 && age < duration;
    });
  }, [pins, selectedCategoryFilter, timeFilter, userId]);

  const filteredListPins = useMemo(() => {
    const searched = !debouncedQuery.trim() || searchResultIds === null
      ? filteredPins
      : filteredPins.filter(pin => searchResultIds.includes(pin.id));
    if (routeInfo) return searched.filter(pin => routeInfo.pinsOnRoute.includes(pin.id));
    return searched;
  }, [filteredPins, debouncedQuery, searchResultIds, routeInfo]);

  const visiblePins = useMemo(() => {
    const inViewport = viewportBounds
      ? (() => {
          const [minLat, maxLat, minLng, maxLng] = viewportBounds;
          return filteredPins.filter(pin =>
            pin.lat >= minLat && pin.lat <= maxLat && pin.lng >= minLng && pin.lng <= maxLng
          );
        })()
      : filteredPins;
    if (selected && filteredPins.some(pin => pin.id === selected.id) && !inViewport.some(pin => pin.id === selected.id)) {
      return [...inViewport, selected];
    }
    return inViewport;
  }, [filteredPins, viewportBounds, selected]);

  return { pins, setPins, loadPins, matchingIds, filteredPins, filteredListPins, visiblePins };
}
