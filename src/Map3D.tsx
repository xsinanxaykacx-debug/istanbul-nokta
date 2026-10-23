import { useEffect, useRef } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';

interface Map3DProps {
  pins: any[];
  onMapClick: (lat: number, lng: number) => void;
  onPinSelect: (pin: any) => void;
  userPosition: [number, number] | null;
  flyToCoords: [number, number] | null;
  routeLine: [number, number][] | null;
  routeStart: [number, number] | null;
  routeEnd: [number, number] | null;
  showTraffic: boolean;
  showHeatmap: boolean;
  tomtomApiKey: string;
}

export default function Map3D({ 
  pins, onMapClick, onPinSelect, userPosition, flyToCoords, 
  routeLine, routeStart, routeEnd, showTraffic, showHeatmap, tomtomApiKey 
}: Map3DProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const markers = useRef<any[]>([]);
  const routeMarkers = useRef<any[]>([]);

  // Haritayı Başlatma
  useEffect(() => {
    if (map.current || !mapContainer.current) return;

    const script = document.createElement('script');
    script.src = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js';
    script.async = true;
    
    script.onload = () => {
      const maplibregl = (window as any).maplibregl;
      if (!maplibregl) return;

      maplibregl.workerUrl = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl-csp-worker.js';

      map.current = new maplibregl.Map({
        container: mapContainer.current,
        style: 'https://tiles.openfreemap.org/styles/liberty', 
        center: [28.9784, 41.0082],
        zoom: 15,
        pitch: 60,
        bearing: -20,
        attributionControl: false
      });

      map.current.on('click', (e: any) => {
        onMapClick(e.lngLat.lat, e.lngLat.lng);
      });

      map.current.addControl(new maplibregl.NavigationControl(), 'top-left');
      setTimeout(() => { map.current?.resize(); }, 500);
    };

    document.head.appendChild(script);

    return () => {
      if (map.current) { map.current.remove(); map.current = null; }
      const existingScript = document.querySelector('script[src*="maplibre-gl"]');
      if (existingScript) document.head.removeChild(existingScript);
    };
  }, []);

  // Pinleri Çizme
  useEffect(() => {
    const maplibregl = (window as any).maplibregl;
    if (!map.current || !maplibregl) return;

    markers.current.forEach(m => m.remove());
    markers.current = [];

    pins.forEach(pin => {
      if (!pin.lat || !pin.lng) return; // NULL kontrolü

      const color = pin.category === 'YEŞİL' ? '#1e8e55' : 
                    pin.category === 'MAVİ' ? '#3b82f6' : 
                    pin.category === 'GRİ' ? '#9ca3af' : '#d64545';
      
      const el = document.createElement('div');
      el.style.width = '20px';
      el.style.height = '20px';
      el.style.borderRadius = '50%';
      el.style.backgroundColor = color;
      el.style.border = '2px solid white';
      el.style.boxShadow = '0 2px 6px rgba(0,0,0,0.4)';
      el.style.cursor = 'pointer';

      el.addEventListener('click', (e) => {
        e.stopPropagation();
        onPinSelect(pin);
      });

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([pin.lng, pin.lat])
        .addTo(map.current);
      
      markers.current.push(marker);
    });

    if (userPosition && userPosition[0] && userPosition[1]) {
      const userEl = document.createElement('div');
      userEl.style.width = '16px';
      userEl.style.height = '16px';
      userEl.style.borderRadius = '50%';
      userEl.style.backgroundColor = '#2785ff';
      userEl.style.border = '3px solid white';
      userEl.style.boxShadow = '0 0 0 4px rgba(39, 133, 255, 0.3)';

      const userMarker = new maplibregl.Marker({ element: userEl })
        .setLngLat([userPosition[1], userPosition[0]])
        .addTo(map.current);
      
      markers.current.push(userMarker);
    }
  }, [pins, userPosition]);

  // Rota Çizgisi ve Noktaları
  useEffect(() => {
    const maplibregl = (window as any).maplibregl;
    if (!map.current || !maplibregl) return;

    if (map.current.getLayer('route-layer')) map.current.removeLayer('route-layer');
    if (map.current.getSource('route-source')) map.current.removeSource('route-source');
    routeMarkers.current.forEach(m => m.remove());
    routeMarkers.current = [];

    if (routeLine && routeLine.length > 0) {
      const coordinates = routeLine.map(coord => [coord[1], coord[0]]);

      map.current.addSource('route-source', {
        type: 'geojson',
        data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coordinates } }
      });

      map.current.addLayer({
        id: 'route-layer', type: 'line', source: 'route-source',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#2684ff', 'line-width': 6, 'line-opacity': 0.8 }
      });

      const bounds = coordinates.reduce((acc: any, coord: any) => acc.extend(coord), new maplibregl.LngLatBounds(coordinates[0], coordinates[0]));
      map.current.fitBounds(bounds, { padding: 50 });
    }

    if (routeStart) {
      const startEl = document.createElement('div');
      startEl.innerText = 'A';
      startEl.style.cssText = 'width:24px;height:24px;border-radius:50%;background-color:#16a34a;color:white;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:12px;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.4)';
      routeMarkers.current.push(new maplibregl.Marker({ element: startEl }).setLngLat([routeStart[1], routeStart[0]]).addTo(map.current));
    }
    if (routeEnd) {
      const endEl = document.createElement('div');
      endEl.innerText = 'B';
      endEl.style.cssText = 'width:24px;height:24px;border-radius:50%;background-color:#dc2626;color:white;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:12px;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.4)';
      routeMarkers.current.push(new maplibregl.Marker({ element: endEl }).setLngLat([routeEnd[1], routeEnd[0]]).addTo(map.current));
    }
  }, [routeLine, routeStart, routeEnd]);

  // TRAFİK KATMANI
  useEffect(() => {
    const maplibregl = (window as any).maplibregl;
    if (!map.current || !maplibregl) return;

    if (map.current.getLayer('traffic-layer')) map.current.removeLayer('traffic-layer');
    if (map.current.getSource('traffic-source')) map.current.removeSource('traffic-source');

    if (showTraffic && tomtomApiKey) {
      map.current.addSource('traffic-source', {
        type: 'raster',
        tiles: [`https://api.tomtom.com/traffic/map/4/tile/flow/relative-delay/{z}/{x}/{y}.png?key=${tomtomApiKey}&t=live`],
        tileSize: 256
      });
      map.current.addLayer({
        id: 'traffic-layer',
        type: 'raster',
        source: 'traffic-source',
        paint: { 'raster-opacity': 0.8 }
      });
    }
  }, [showTraffic, tomtomApiKey]);
  // Konum alındığında 3D haritayı oraya uçur
  useEffect(() => {
    if (map.current && userPosition) {
      map.current.flyTo({
        center: [userPosition[1], userPosition[0]], // MapLibre lng, lat bekler
        zoom: 16,
        pitch: 60,
        duration: 1500
      });
    }
  }, [userPosition]);
  // ISI HARİTASI KATMANI
  useEffect(() => {
    const maplibregl = (window as any).maplibregl;
    if (!map.current || !maplibregl) return;

    if (map.current.getLayer('heatmap-layer')) map.current.removeLayer('heatmap-layer');
    if (map.current.getSource('heatmap-source')) map.current.removeSource('heatmap-source');

    if (showHeatmap && pins.length > 0) {
      // Pinleri GeoJSON formatına çevir
      const geojson = {
        type: 'FeatureCollection',
        features: pins.filter(p => p.lat && p.lng).map(p => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
          properties: {}
        }))
      };

      map.current.addSource('heatmap-source', { type: 'geojson', data: geojson });
      map.current.addLayer({
        id: 'heatmap-layer',
        type: 'heatmap',
        source: 'heatmap-source',
        paint: {
          'heatmap-weight': 1,
          'heatmap-intensity': 1,
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0, 'rgba(0,0,255,0)', 0.4, 'blue', 0.6, 'cyan', 0.7, 'lime', 0.8, 'yellow', 1, 'red'
          ],
          'heatmap-radius': 30
        }
      });
    }
  }, [showHeatmap, pins]);

  // FlyTo
  useEffect(() => {
    if (map.current && flyToCoords && flyToCoords[0] && flyToCoords[1]) {
      map.current.flyTo({ center: flyToCoords, zoom: 16, pitch: 60, bearing: -20, duration: 1500 });
    }
  }, [flyToCoords]);

  return <div ref={mapContainer} style={{ width: '100%', height: '100%', borderRadius: '18px', background: '#f1f5f9' }} />;
}