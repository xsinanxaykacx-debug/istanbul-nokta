import { useEffect, useMemo, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MaptoolkitScene3DControl } from '@maptoolkit/maplibre-scene3d-control';

interface AerialPilotProps {
  pins: any[];
  onMapClick: (lat: number, lng: number) => void;
  onPinSelect: (pin: any) => void;
  userPosition: [number, number] | null;
  flyToCoords: [number, number] | null;
  flyToUserCoords: [number, number] | null;
  isNavigating?: boolean;
  draftPosition: [number, number] | null;
  routeLine: [number, number][] | null;
  routeStart: [number, number] | null;
  routeEnd: [number, number] | null;
  showTraffic: boolean;
  showHeatmap: boolean;
  tomtomApiKey: string;
}

const SOURCE = 'aerial-pilot-pins';
const LAYER = 'aerial-pilot-pins-layer';
const USER_SOURCE = 'aerial-user-position';
const USER_LAYER = 'aerial-user-dot';

export default function AerialPilot({
  pins, onMapClick, onPinSelect, userPosition, flyToCoords, flyToUserCoords, draftPosition
}: AerialPilotProps) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const callbacks = useRef({ onMapClick, onPinSelect, pins });

  const features = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: pins.filter(p => p && p.id != null && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)))
      .map(p => ({
        type: 'Feature' as const,
        id: String(p.id),
        properties: { id: String(p.id), category: String(p.category || 'KIRMIZI') },
        geometry: { type: 'Point' as const, coordinates: [Number(p.lng), Number(p.lat)] as [number, number] }
      }))
  }), [pins]);

  useEffect(() => { callbacks.current = { onMapClick, onPinSelect, pins }; }, [onMapClick, onPinSelect, pins]);

  useEffect(() => {
    if (!container.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: container.current,
      // Maptoolkit Street: vector cartography + 3D building extrusion, not satellite imagery.
      style: 'https://styles.maptoolkit.org/street.json',
      center: [28.9784, 41.0082],
      zoom: 15.1,
      pitch: 66,
      bearing: -24,
      maxPitch: 80,
      attributionControl: { compact: true }
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-left');

    map.on('load', () => {
      // Adds detailed roof geometry and 3D tree models when the provider's scene tiles are available.
      // The base Street style still renders its own extruded buildings if detailed scene access is unavailable.
      try {
        map.addControl(new MaptoolkitScene3DControl({ enabled: true, minzoom: 12 }));
      } catch (error) {
        console.warn('Maptoolkit 3D scene control could not be initialized:', error);
      }

      map.addSource(SOURCE, { type: 'geojson', data: {
        type: 'FeatureCollection',
        features: callbacks.current.pins
          .filter(p => p && p.id != null && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)))
          .map(p => ({
            type: 'Feature', id: String(p.id),
            properties: { id: String(p.id), category: String(p.category || 'KIRMIZI') },
            geometry: { type: 'Point', coordinates: [Number(p.lng), Number(p.lat)] }
          }))
      } as any });

      map.addLayer({
        id: LAYER, type: 'circle', source: SOURCE,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 4, 17, 9],
          'circle-color': ['match', ['get', 'category'], 'YEŞİL', '#39ff14', 'MAVİ', '#00bfff', 'SARI', '#ffcc33', 'GRİ', '#94a3b8', '#f04452'],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1.5,
          'circle-opacity': 0.96
        }
      });

      map.on('click', LAYER, event => {
        const id = event.features?.[0]?.properties?.id;
        const pin = callbacks.current.pins.find(p => String(p.id) === String(id));
        if (pin) callbacks.current.onPinSelect(pin);
      });
      map.on('click', event => {
        const hits = map.queryRenderedFeatures(event.point, { layers: [LAYER] });
        if (!hits.length) callbacks.current.onMapClick(event.lngLat.lat, event.lngLat.lng);
      });

      if (userPosition) setUserMarker(map, userPosition);
    });

    return () => { map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const source = mapRef.current?.getSource(SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (source) source.setData(features as any);
  }, [features]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && userPosition && map.isStyleLoaded()) setUserMarker(map, userPosition);
  }, [userPosition]);

  useEffect(() => {
    if (flyToCoords) mapRef.current?.flyTo({ center: [flyToCoords[1], flyToCoords[0]], zoom: 17, essential: true });
  }, [flyToCoords]);

  useEffect(() => {
    if (flyToUserCoords) mapRef.current?.flyTo({ center: [flyToUserCoords[1], flyToUserCoords[0]], zoom: 17, essential: true });
  }, [flyToUserCoords]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !draftPosition) return;
    const marker = new maplibregl.Marker({ color: '#e6a23c' }).setLngLat([draftPosition[1], draftPosition[0]]).addTo(map);
    return () => { marker.remove(); };
  }, [draftPosition]);

  return <div ref={container} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', background: '#d8d4c8' }} />;
}

function setUserMarker(map: maplibregl.Map, position: [number, number]) {
  const data = {
    type: 'Feature' as const,
    properties: {},
    geometry: { type: 'Point' as const, coordinates: [position[1], position[0]] as [number, number] }
  };
  const existing = map.getSource(USER_SOURCE) as maplibregl.GeoJSONSource | undefined;
  if (existing) {
    existing.setData(data);
    return;
  }
  map.addSource(USER_SOURCE, { type: 'geojson', data });
  map.addLayer({
    id: USER_LAYER, type: 'circle', source: USER_SOURCE,
    paint: { 'circle-radius': 7, 'circle-color': '#168cff', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2.5 }
  });
}
