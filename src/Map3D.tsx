import { useEffect, useRef, useState } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import * as maplibregl from 'maplibre-gl';
// Vite'ın worker dosyasını paketlemesini ve bize URL vermesini sağlıyoruz
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

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
  pins,
  onMapClick,
  onPinSelect,
  userPosition,
  flyToCoords,
  flyToUserCoords,
  draftPosition,
  routeLine,
  routeStart,
  routeEnd,
  showTraffic,
  showHeatmap,
  tomtomApiKey,
}: Map3DProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const routeMarkers = useRef<maplibregl.Marker[]>([]);
  const draftMarker = useRef<maplibregl.Marker | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  const onMapClickRef = useRef(onMapClick);
  const onPinSelectRef = useRef(onPinSelect);
  
  useEffect(() => {
    onMapClickRef.current = onMapClick;
    onPinSelectRef.current = onPinSelect;
  }, [onMapClick, onPinSelect]);

  // Haritayı başlat
  useEffect(() => {
    if (map.current || !mapContainer.current) return;

    // KRİTİK: Worker yolunu MapLibre'ye veriyoruz (Harita oluşmadan önce)
    maplibregl.setWorkerUrl(maplibreWorkerUrl);

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: 'https://tiles.openfreemap.org/styles/liberty',
      center: [28.9784, 41.0082],
      zoom: 15,
      pitch: 60,
      bearing: -20,
      attributionControl: false,
    });

    map.current.on('click', (e) => {
      onMapClickRef.current(e.lngLat.lat, e.lngLat.lng);
    });

    map.current.addControl(new maplibregl.NavigationControl(), 'top-left');

    map.current.once('load', () => {
      setMapLoaded(true);
    });

    const resizeTimer = window.setTimeout(() => {
      map.current?.resize();
    }, 500);

    return () => {
      window.clearTimeout(resizeTimer);
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
      setMapLoaded(false);
    };
  }, []);

  // Pinleri Çiz
  useEffect(() => {
    const mapInstance = map.current;
    if (!mapInstance || !mapLoaded) return;

    markers.current.forEach((m) => m.remove());
    markers.current = [];

    pins.forEach((pin) => {
      if (
        typeof pin.lat !== 'number' ||
        typeof pin.lng !== 'number' ||
        isNaN(pin.lat) ||
        isNaN(pin.lng)
      )
        return;

      const color =
        pin.category === 'YEŞİL'
          ? '#1e8e55'
          : pin.category === 'MAVİ'
          ? '#3b82f6'
          : pin.category === 'GRİ'
          ? '#9ca3af'
          : '#d64545';

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
        .addTo(mapInstance);

      markers.current.push(marker);
    });

    if (
      userPosition &&
      typeof userPosition[0] === 'number' &&
      typeof userPosition[1] === 'number' &&
      !isNaN(userPosition[0]) &&
      !isNaN(userPosition[1])
    ) {
      const userEl = document.createElement('div');
      userEl.style.width = '16px';
      userEl.style.height = '16px';
      userEl.style.borderRadius = '50%';
      userEl.style.backgroundColor = '#2785ff';
      userEl.style.border = '3px solid white';
      userEl.style.boxShadow = '0 0 0 4px rgba(39, 133, 255, 0.3)';

      const userMarker = new maplibregl.Marker({ element: userEl })
        .setLngLat([userPosition[1], userPosition[0]])
        .addTo(mapInstance);

      markers.current.push(userMarker);
    }
  }, [pins, userPosition, mapLoaded]);

  // Taslak Pin Çiz
  useEffect(() => {
    const mapInstance = map.current;
    if (!mapInstance || !mapLoaded) return;

    if (draftMarker.current) {
      draftMarker.current.remove();
      draftMarker.current = null;
    }

    if (
      draftPosition &&
      typeof draftPosition[0] === 'number' &&
      typeof draftPosition[1] === 'number' &&
      !isNaN(draftPosition[0]) &&
      !isNaN(draftPosition[1])
    ) {
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
        .addTo(mapInstance);
    }
  }, [draftPosition, mapLoaded]);

  // Rota Çizgisi
  useEffect(() => {
    const mapInstance = map.current;
    if (!mapInstance || !mapLoaded) return;

    if (mapInstance.getLayer('route-layer')) mapInstance.removeLayer('route-layer');
    if (mapInstance.getSource('route-source')) mapInstance.removeSource('route-source');
    routeMarkers.current.forEach((m) => m.remove());
    routeMarkers.current = [];

    if (routeLine && routeLine.length > 0) {
      const validCoords: [number, number][] = routeLine
        .filter(
          (c) =>
            typeof c[0] === 'number' &&
            typeof c[1] === 'number' &&
            !isNaN(c[0]) &&
            !isNaN(c[1])
        )
        .map((c) => [c[1], c[0]] as [number, number]);

      if (validCoords.length > 1) {
        try {
          mapInstance.addSource('route-source', {
            type: 'geojson',
            data: {
              type: 'Feature',
              properties: {},
              geometry: { type: 'LineString', coordinates: validCoords },
            },
          });

          mapInstance.addLayer({
            id: 'route-layer',
            type: 'line',
            source: 'route-source',
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': '#2684ff', 'line-width': 6, 'line-opacity': 0.8 },
          });

          const bounds = new maplibregl.LngLatBounds(validCoords[0], validCoords[0]);
          for (const coord of validCoords) bounds.extend(coord);
          mapInstance.fitBounds(bounds, { padding: 50 });
        } catch (err) {
          console.error('Rota çizilirken hata:', err);
        }
      }
    }

    if (
      routeStart &&
      typeof routeStart[0] === 'number' &&
      typeof routeStart[1] === 'number' &&
      !isNaN(routeStart[0]) &&
      !isNaN(routeStart[1])
    ) {
      const startEl = document.createElement('div');
      startEl.innerText = 'A';
      startEl.style.cssText =
        'width:24px;height:24px;border-radius:50%;background-color:#16a34a;color:white;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:12px;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.4)';
      routeMarkers.current.push(
        new maplibregl.Marker({ element: startEl })
          .setLngLat([routeStart[1], routeStart[0]])
          .addTo(mapInstance)
      );
    }

    if (
      routeEnd &&
      typeof routeEnd[0] === 'number' &&
      typeof routeEnd[1] === 'number' &&
      !isNaN(routeEnd[0]) &&
      !isNaN(routeEnd[1])
    ) {
      const endEl = document.createElement('div');
      endEl.innerText = 'B';
      endEl.style.cssText =
        'width:24px;height:24px;border-radius:50%;background-color:#dc2626;color:white;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:12px;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.4)';
      routeMarkers.current.push(
        new maplibregl.Marker({ element: endEl })
          .setLngLat([routeEnd[1], routeEnd[0]])
          .addTo(mapInstance)
      );
    }
  }, [routeLine, routeStart, routeEnd, mapLoaded]);

  // Trafik Katmanı
  useEffect(() => {
    const mapInstance = map.current;
    if (!mapInstance || !mapLoaded) return;

    if (mapInstance.getLayer('traffic-layer')) mapInstance.removeLayer('traffic-layer');
    if (mapInstance.getSource('traffic-source')) mapInstance.removeSource('traffic-source');

    if (showTraffic && tomtomApiKey) {
      mapInstance.addSource('traffic-source', {
        type: 'raster',
        tiles: [
          `https://api.tomtom.com/traffic/map/4/tile/flow/relative-delay/{z}/{x}/{y}.png?key=${tomtomApiKey}&t=live`,
        ],
        tileSize: 256,
      });
      mapInstance.addLayer({
        id: 'traffic-layer',
        type: 'raster',
        source: 'traffic-source',
        paint: { 'raster-opacity': 0.8 },
      });
    }
  }, [showTraffic, tomtomApiKey, mapLoaded]);

  // Isı Haritası Katmanı
  useEffect(() => {
    const mapInstance = map.current;
    if (!mapInstance || !mapLoaded) return;

    if (mapInstance.getLayer('heatmap-layer')) mapInstance.removeLayer('heatmap-layer');
    if (mapInstance.getSource('heatmap-source')) mapInstance.removeSource('heatmap-source');

    if (showHeatmap && pins.length > 0) {
      const validPins = pins.filter(
        (p) =>
          typeof p.lat === 'number' &&
          typeof p.lng === 'number' &&
          !isNaN(p.lat) &&
          !isNaN(p.lng)
      );

      if (validPins.length > 0) {
        const geojson = {
          type: 'FeatureCollection' as const,
          features: validPins.map((p) => ({
            type: 'Feature' as const,
            geometry: {
              type: 'Point' as const,
              coordinates: [p.lng, p.lat],
            },
            properties: {},
          })),
        };

        mapInstance.addSource('heatmap-source', { type: 'geojson', data: geojson });
        mapInstance.addLayer({
          id: 'heatmap-layer',
          type: 'heatmap',
          source: 'heatmap-source',
          paint: {
            'heatmap-weight': 1,
            'heatmap-intensity': 1,
            'heatmap-color': [
              'interpolate',
              ['linear'],
              ['heatmap-density'],
              0, 'rgba(0,0,255,0)',
              0.4, 'blue',
              0.6, 'cyan',
              0.7, 'lime',
              0.8, 'yellow',
              1, 'red',
            ],
            'heatmap-radius': 30,
          },
        });
      }
    }
  }, [showHeatmap, pins, mapLoaded]);

  // FlyTo (arama sonucu / seçili pin)
  useEffect(() => {
    if (
      map.current &&
      mapLoaded &&
      flyToCoords &&
      typeof flyToCoords[0] === 'number' &&
      typeof flyToCoords[1] === 'number' &&
      !isNaN(flyToCoords[0]) &&
      !isNaN(flyToCoords[1])
    ) {
      map.current.flyTo({
        center: flyToCoords,
        zoom: 16,
        pitch: 60,
        bearing: -20,
        duration: 1500,
      });
    }
  }, [flyToCoords, mapLoaded]);

  // FlyTo (GPS konumu)
  useEffect(() => {
    if (
      map.current &&
      mapLoaded &&
      flyToUserCoords &&
      typeof flyToUserCoords[0] === 'number' &&
      typeof flyToUserCoords[1] === 'number' &&
      !isNaN(flyToUserCoords[0]) &&
      !isNaN(flyToUserCoords[1])
    ) {
      map.current.flyTo({
        center: [flyToUserCoords[1], flyToUserCoords[0]],
        zoom: 16,
        pitch: 60,
        bearing: -20,
        duration: 1500,
      });
    }
  }, [flyToUserCoords, mapLoaded]);

  return (
    <div
      ref={mapContainer}
      style={{
        width: '100%',
        height: '100%',
        borderRadius: '18px',
        background: '#f1f5f9',
      }}
    />
  );
}
