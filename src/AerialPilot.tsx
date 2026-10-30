import { useEffect, useMemo, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

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
      style: {
        version: 8,
        sources: {
          'esri-world-imagery': {
            type: 'raster',
            tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
            tileSize: 256,
            attribution: 'Imagery: Esri, Maxar, Earthstar Geographics, and the GIS User Community'
          }
        },
        layers: [{ id: 'aerial-imagery', type: 'raster', source: 'esri-world-imagery', paint: { 'raster-saturation': 0.12, 'raster-contrast': 0.08 } }]
      },
      center: [28.9784, 41.0082],
      zoom: 15.2,
      pitch: 58,
      bearing: -22,
      maxPitch: 75,
      attributionControl: { compact: true }
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-left');
    map.on('load', () => {
      map.addSource(SOURCE, { type: 'geojson', data: callbacks.current.pins.length ? {
        type: 'FeatureCollection',
        features: callbacks.current.pins.filter(p => p && p.id != null && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng))).map(p => ({
          type: 'Feature', id: String(p.id), properties: { id: String(p.id), category: String(p.category || 'KIRMIZI') },
          geometry: { type: 'Point', coordinates: [Number(p.lng), Number(p.lat)] }
        }))
      } as any : { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: LAYER, type: 'circle', source: SOURCE,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 4, 17, 9],
          'circle-color': ['match', ['get', 'category'], 'YEŞİL', '#39ff14', 'MAVİ', '#00e5ff', 'SARI', '#ffea00', 'GRİ', '#94a3b8', '#ff1744'],
          'circle-stroke-color': '#07111f', 'circle-stroke-width': 2,
          'circle-opacity': 0.95
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
    });
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const source = mapRef.current?.getSource(SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (source) source.setData(features as any);
  }, [features]);

  useEffect(() => { if (flyToCoords) mapRef.current?.flyTo({ center: [flyToCoords[1], flyToCoords[0]], zoom: 17, essential: true }); }, [flyToCoords]);
  useEffect(() => { if (flyToUserCoords) mapRef.current?.flyTo({ center: [flyToUserCoords[1], flyToUserCoords[0]], zoom: 17, essential: true }); }, [flyToUserCoords]);
  useEffect(() => {
    if (!mapRef.current || !userPosition) return;
    mapRef.current.getSource('aerial-user-position') && mapRef.current.removeLayer('aerial-user-dot');
    if (mapRef.current.getSource('aerial-user-position')) mapRef.current.removeSource('aerial-user-position');
    mapRef.current.addSource('aerial-user-position', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [userPosition[1], userPosition[0]] } } });
    mapRef.current.addLayer({ id: 'aerial-user-dot', type: 'circle', source: 'aerial-user-position', paint: { 'circle-radius': 7, 'circle-color': '#38bdf8', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
  }, [userPosition]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !draftPosition) return;
    const marker = new maplibregl.Marker({ color: '#facc15' }).setLngLat([draftPosition[1], draftPosition[0]]).addTo(map);
    return () => { marker.remove(); };
  }, [draftPosition]);

  return <div ref={container} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', background: '#18212b' }} />;
}
