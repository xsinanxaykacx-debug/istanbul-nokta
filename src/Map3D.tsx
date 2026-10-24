import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

interface Map3DProps {
  pins: any[];
  onMapClick: (lat: number, lng: number) => void;
  onPinSelect: (pin: any) => void;
  userPosition: [number, number] | null;
  flyToCoords: [number, number] | null;
  flyToUserCoords: [number, number] | null;
  draftPosition: [number, number] | null;
  routeLine: [number, number][] | null;
  routeStart: [number, number] | null;
  routeEnd: [number, number] | null;
  showTraffic: boolean;
  showHeatmap: boolean;
  tomtomApiKey: string;
}

export default function Map3D({ 
  pins, onMapClick, onPinSelect, userPosition, flyToCoords, flyToUserCoords, draftPosition,
  routeLine, routeStart, routeEnd, showTraffic, showHeatmap, tomtomApiKey 
}: Map3DProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const [mapReady, setMapReady] = useState(false);
  const markers = useRef<any[]>([]);
  const routeMarkers = useRef<any[]>([]);
  const draftMarker = useRef<any>(null);

  const onMapClickRef = useRef(onMapClick);
  const onPinSelectRef = useRef(onPinSelect);
  useEffect(() => {
    onMapClickRef.current = onMapClick;
    onPinSelectRef.current = onPinSelect;
  }, [onMapClick, onPinSelect]);

  useEffect(() => {
    if (map.current || !mapContainer.current) return;

    const mapInstance = new maplibregl.Map({
      container: mapContainer.current,
      style: 'https://tiles.openfreemap.org/styles/liberty',
      center: [28.9784, 41.0082],
      zoom: 15,
      pitch: 60,
      bearing: -20,
      attributionControl: false
    });
    map.current = mapInstance;
    mapInstance.once('load', () => setMapReady(true));

    mapInstance.on('click', (e: any) => {
      onMapClickRef.current(e.lngLat.lat, e.lngLat.lng);
    });
    mapInstance.addControl(new maplibregl.NavigationControl(), 'top-left');

    const resizeTimer = window.setTimeout(() => mapInstance.resize(), 500);
    return () => {
      window.clearTimeout(resizeTimer);
      setMapReady(false);
      mapInstance.remove();
      if (map.current === mapInstance) map.current = null;
    };
  }, []);

  // Pinleri Çiz
  useEffect(() => {
    if (!map.current || !mapReady) return;

    markers.current.forEach(m => m.remove());
    markers.current = [];

    pins.forEach(pin => {
      if (typeof pin.lat !== 'number' || typeof pin.lng !== 'number' || isNaN(pin.lat) || isNaN(pin.lng)) return;

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
        onPinSelectRef.current(pin);
      });

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([pin.lng, pin.lat])
        .addTo(map.current);
      
      markers.current.push(marker);
    });

    if (userPosition && typeof userPosition[0] === 'number' && typeof userPosition[1] === 'number' && !isNaN(userPosition[0]) && !isNaN(userPosition[1])) {
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
  }, [pins, userPosition, mapReady]);

  // Taslak Pin Çiz
  useEffect(() => {
    if (!map.current || !mapReady) return;

    if (draftMarker.current) {
      draftMarker.current.remove();
      draftMarker.current = null;
    }

    if (draftPosition && typeof draftPosition[0] === 'number' && typeof draftPosition[1] === 'number' && !isNaN(draftPosition[0]) && !isNaN(draftPosition[1])) {
      const el = document.createElement('div');
      el.style.width = '28px';
      el.style.height = '28px';
      el.style.borderRadius = '50% 50% 50% 4px';
      el.style.transform = 'rotate(-45deg)';
      el.style.backgroundColor = '#f97316';
      el.style.border = '3px solid white';
      el.style.boxShadow = '0 3px 8px rgba(0,0,0,0.4)';
      
      const inner = document.createElement('div');
      inner.style.width = '8px';
      inner.style.height = '8px';
      inner.style.borderRadius = '50%';
      inner.style.backgroundColor = 'white';
      inner.style.position = 'absolute';
      inner.style.top = '7px';
      inner.style.left = '7px';
      el.appendChild(inner);

      draftMarker.current = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([draftPosition[1], draftPosition[0]])
        .addTo(map.current);
    }
  }, [draftPosition, mapReady]);

  // Rota Çizgisi
  useEffect(() => {
    if (!map.current || !mapReady) return;

    if (map.current.getLayer('route-layer')) map.current.removeLayer('route-layer');
    if (map.current.getSource('route-source')) map.current.removeSource('route-source');
    routeMarkers.current.forEach(m => m.remove());
    routeMarkers.current = [];

    if (routeLine && routeLine.length > 0) {
      const validCoords = routeLine
        .filter(c => typeof c[0] === 'number' && typeof c[1] === 'number' && !isNaN(c[0]) && !isNaN(c[1]))
        .map(c => [c[1], c[0]]);

      if (validCoords.length > 1) {
        try {
          map.current.addSource('route-source', {
            type: 'geojson',
            data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: validCoords } }
          });

          map.current.addLayer({
            id: 'route-layer', type: 'line', source: 'route-source',
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': '#2684ff', 'line-width': 6, 'line-opacity': 0.8 }
          });

          const bounds = validCoords.reduce((acc: any, coord: any) => acc.extend(coord), new maplibregl.LngLatBounds(validCoords[0], validCoords[0]));
          map.current.fitBounds(bounds, { padding: 50 });
        } catch (err) {
          console.error("Rota çizilirken hata:", err);
        }
      }
    }

    if (routeStart && typeof routeStart[0] === 'number' && typeof routeStart[1] === 'number' && !isNaN(routeStart[0]) && !isNaN(routeStart[1])) {
      const startEl = document.createElement('div');
      startEl.innerText = 'A';
      startEl.style.cssText = 'width:24px;height:24px;border-radius:50%;background-color:#16a34a;color:white;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:12px;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.4)';
      routeMarkers.current.push(new maplibregl.Marker({ element: startEl }).setLngLat([routeStart[1], routeStart[0]]).addTo(map.current));
    }
    
    if (routeEnd && typeof routeEnd[0] === 'number' && typeof routeEnd[1] === 'number' && !isNaN(routeEnd[0]) && !isNaN(routeEnd[1])) {
      const endEl = document.createElement('div');
      endEl.innerText = 'B';
      endEl.style.cssText = 'width:24px;height:24px;border-radius:50%;background-color:#dc2626;color:white;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:12px;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.4)';
      routeMarkers.current.push(new maplibregl.Marker({ element: endEl }).setLngLat([routeEnd[1], routeEnd[0]]).addTo(map.current));
    }
  }, [routeLine, routeStart, routeEnd, mapReady]);

  // Trafik Katmanı
  useEffect(() => {
    if (!map.current || !mapReady) return;

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
  }, [showTraffic, tomtomApiKey, mapReady]);

  // Isı Haritası Katmanı
  useEffect(() => {
    if (!map.current || !mapReady) return;

    if (map.current.getLayer('heatmap-layer')) map.current.removeLayer('heatmap-layer');
    if (map.current.getSource('heatmap-source')) map.current.removeSource('heatmap-source');

    if (showHeatmap && pins.length > 0) {
      const validPins = pins.filter(p => typeof p.lat === 'number' && typeof p.lng === 'number' && !isNaN(p.lat) && !isNaN(p.lng));
      
      if (validPins.length > 0) {
        const geojson = {
          type: 'FeatureCollection',
          features: validPins.map(p => ({
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
    }
  }, [showHeatmap, pins, mapReady]);

  // FlyTo İşlemleri
  useEffect(() => {
    if (map.current && mapReady && flyToCoords && typeof flyToCoords[0] === 'number' && typeof flyToCoords[1] === 'number' && !isNaN(flyToCoords[0]) && !isNaN(flyToCoords[1])) {
      map.current.flyTo({ center: flyToCoords, zoom: 16, pitch: 60, bearing: -20, duration: 1500 });
    }
  }, [flyToCoords, mapReady]);

  useEffect(() => {
    if (map.current && mapReady && flyToUserCoords && typeof flyToUserCoords[0] === 'number' && typeof flyToUserCoords[1] === 'number' && !isNaN(flyToUserCoords[0]) && !isNaN(flyToUserCoords[1])) {
      map.current.flyTo({ center: [flyToUserCoords[1], flyToUserCoords[0]], zoom: 16, pitch: 60, bearing: -20, duration: 1500 });
    }
  }, [flyToUserCoords, mapReady]);

  return <div ref={mapContainer} style={{ width: '100%', height: '100%', borderRadius: '18px', background: '#f1f5f9' }} />;
}
