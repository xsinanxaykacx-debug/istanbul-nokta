import { useEffect, useMemo, useRef, useState } from 'react';
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

const PIN_SOURCE_ID = 'pin-clusters-source';
const PIN_CLUSTER_LAYER_ID = 'pin-clusters';
const PIN_CLUSTER_COUNT_LAYER_ID = 'pin-cluster-count';
const PIN_POINT_LAYER_ID = 'pin-points';
const TELEGRAM_PIN_MARKER = '[AYTAR-RADAR]';
const TELEGRAM_OWNER_ID_PREFIX = 'a09a270f-';

const PIN_ICON_IMAGES = [
  {
    name: 'pin-yesil',
    dataUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0OCIgaGVpZ2h0PSI1OCIgdmlld0JveD0iMCAwIDQ4IDU4Ij48cGF0aCBkPSJNMjQgMkMxMi40IDIgMyAxMS40IDMgMjNjMCAxNC42IDIxIDM0IDIxIDM0czIxLTE5LjQgMjEtMzRDNDUgMTEuNCAzNS42IDIgMjQgMloiIGZpbGw9IiMzOUZGMTQiIHN0cm9rZT0iIzExMTgyNyIgc3Ryb2tlLXdpZHRoPSIyIi8+PHRleHQgeD0iMjQiIHk9IjIzIiBmaWxsPSIjMTExODI3IiBmb250LWZhbWlseT0iQXJpYWwsSGVsdmV0aWNhLHNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMjAiIGZvbnQtd2VpZ2h0PSI3MDAiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGRvbWluYW50LWJhc2VsaW5lPSJjZW50cmFsIj5ZPC90ZXh0Pjwvc3ZnPg==',
  }
  {
    name: 'pin-mavi',
    dataUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0OCIgaGVpZ2h0PSI1OCIgdmlld0JveD0iMCAwIDQ4IDU4Ij48cGF0aCBkPSJNMjQgMkMxMi40IDIgMyAxMS40IDMgMjNjMCAxNC42IDIxIDM0IDIxIDM0czIxLTE5LjQgMjEtMzRDNDUgMTEuNCAzNS42IDIgMjQgMloiIGZpbGw9IiMwMEU1RkYiIHN0cm9rZT0iIzExMTgyNyIgc3Ryb2tlLXdpZHRoPSIyIi8+PHRleHQgeD0iMjQiIHk9IjIzIiBmaWxsPSIjMTExODI3IiBmb250LWZhbWlseT0iQXJpYWwsSGVsdmV0aWNhLHNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMjAiIGZvbnQtd2VpZ2h0PSI3MDAiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGRvbWluYW50LWJhc2VsaW5lPSJjZW50cmFsIj5NPC90ZXh0Pjwvc3ZnPg==',
  }
  {
    name: 'pin-kirmizi',
    dataUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0OCIgaGVpZ2h0PSI1OCIgdmlld0JveD0iMCAwIDQ4IDU4Ij48cGF0aCBkPSJNMjQgMkMxMi40IDIgMyAxMS40IDMgMjNjMCAxNC42IDIxIDM0IDIxIDM0czIxLTE5LjQgMjEtMzRDNDUgMTEuNCAzNS42IDIgMjQgMloiIGZpbGw9IiNGRjE3NDQiIHN0cm9rZT0iIzExMTgyNyIgc3Ryb2tlLXdpZHRoPSIyIi8+PHRleHQgeD0iMjQiIHk9IjIzIiBmaWxsPSIjMTExODI3IiBmb250LWZhbWlseT0iQXJpYWwsSGVsdmV0aWNhLHNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMjAiIGZvbnQtd2VpZ2h0PSI3MDAiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGRvbWluYW50LWJhc2VsaW5lPSJjZW50cmFsIj5LPC90ZXh0Pjwvc3ZnPg==',
  }
  {
    name: 'pin-radar',
    dataUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0OCIgaGVpZ2h0PSI1OCIgdmlld0JveD0iMCAwIDQ4IDU4Ij48cGF0aCBkPSJNMjQgMkMxMi40IDIgMyAxMS40IDMgMjNjMCAxNC42IDIxIDM0IDIxIDM0czIxLTE5LjQgMjEtMzRDNDUgMTEuNCAzNS42IDIgMjQgMloiIGZpbGw9IiM3YzNhZWQiIHN0cm9rZT0iI2ZmZmZmZiIgc3Ryb2tlLXdpZHRoPSIyIi8+PGNpcmNsZSBjeD0iMjQiIGN5PSIyMiIgcj0iMTEiIGZpbGw9Im5vbmUiIHN0cm9rZT0iI2ZmZmZmZiIgc3Ryb2tlLXdpZHRoPSIyIi8+PHBhdGggZD0iTTI0IDExdjIyTTEzIDIyaDIyTTE3IDE1bDE0IDE0TTMxIDE1TDE3IDI5IiBmaWxsPSJub25lIiBzdHJva2U9IiNmZmZmZmYiIHN0cm9rZS13aWR0aD0iMS41IiBzdHJva2UtbGluZWNhcD0icm91bmQiLz48Y2lyY2xlIGN4PSIyNCIgY3k9IjIyIiByPSIzIiBmaWxsPSIjMjJkM2VlIiBzdHJva2U9IiNmZmZmZmYiIHN0cm9rZS13aWR0aD0iMSIvPjwvc3ZnPg==',
  },
  {
    name: 'pin-sari',
    dataUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0OCIgaGVpZ2h0PSI1OCIgdmlld0JveD0iMCAwIDQ4IDU4Ij48cGF0aCBkPSJNMjQgMkMxMi40IDIgMyAxMS40IDMgMjNjMCAxNC42IDIxIDM0IDIxIDM0czIxLTE5LjQgMjEtMzRDNDUgMTEuNCAzNS42IDIgMjQgMloiIGZpbGw9IiNGRkVBMDAiIHN0cm9rZT0iIzExMTgyNyIgc3Ryb2tlLXdpZHRoPSIyIi8+PHRleHQgeD0iMjQiIHk9IjIzIiBmaWxsPSIjMTExODI3IiBmb250LWZhbWlseT0iQXJpYWwsSGVsdmV0aWNhLHNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMjAiIGZvbnQtd2VpZ2h0PSI3MDAiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGRvbWluYW50LWJhc2VsaW5lPSJjZW50cmFsIj5TPC90ZXh0Pjwvc3ZnPg==',
  }
] as const;

async function registerSvgPinIcon(
  mapInstance: maplibregl.Map,
  name: string,
  dataUrl: string
): Promise<void> {
  // MapLibre loadImage SVG kabul etmez; SVG'yi tarayıcıda PNG'ye rasterize edip
  // desteklenen PNG veri URL'sini loadImage ile yükle.
  const svgImage = new Image();
  svgImage.src = dataUrl;
  await svgImage.decode();

  const canvas = document.createElement('canvas');
  canvas.width = svgImage.naturalWidth;
  canvas.height = svgImage.naturalHeight;
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Pin ikonu için 2D canvas oluşturulamadı.');
  }

  context.drawImage(svgImage, 0, 0);
  const { data } = await mapInstance.loadImage(canvas.toDataURL('image/png'));

  if (!mapInstance.hasImage(name)) {
    mapInstance.addImage(name, data);
  }
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
  const userMarker = useRef<maplibregl.Marker | null>(null);
  const routeMarkers = useRef<maplibregl.Marker[]>([]);
  const draftMarker = useRef<maplibregl.Marker | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  const onMapClickRef = useRef(onMapClick);
  const onPinSelectRef = useRef(onPinSelect);
  const pinsRef = useRef(pins);

  const pinFeatureCollection = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: pins
      .filter(
        (pin) =>
          pin &&
          pin.id != null &&
          typeof pin.lat === 'number' &&
          Number.isFinite(pin.lat) &&
          typeof pin.lng === 'number' &&
          Number.isFinite(pin.lng) &&
          pin.lat >= -90 &&
          pin.lat <= 90 &&
          pin.lng >= -180 &&
          pin.lng <= 180
      )
      .map((pin) => ({
        type: 'Feature' as const,
        id: String(pin.id),
        properties: {
          pin_id: String(pin.id),
          category: typeof pin.category === 'string'
            ? (['GRİ', 'Siviller', 'Sivil'].includes(pin.category) ? 'SARI' : pin.category)
            : 'KIRMIZI',
          is_telegram: (typeof pin.owner_id === 'string' && pin.owner_id.toLowerCase().startsWith(TELEGRAM_OWNER_ID_PREFIX)) || (typeof pin.description === 'string' && pin.description.startsWith(`${TELEGRAM_PIN_MARKER} `)),
        },
        geometry: {
          type: 'Point' as const,
          coordinates: [pin.lng, pin.lat] as [number, number],
        },
      })),
  }), [pins]);

  useEffect(() => {
    onMapClickRef.current = onMapClick;
    onPinSelectRef.current = onPinSelect;
  }, [onMapClick, onPinSelect]);

  useEffect(() => {
    pinsRef.current = pins;
  }, [pins]);

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

    map.current.addControl(new maplibregl.NavigationControl(), 'top-left');

    const mapInstance = map.current;
    if (!mapInstance) return;

    mapInstance.once('load', () => {
      void (async () => {
        const iconResults = await Promise.allSettled(
          PIN_ICON_IMAGES.map(({ name, dataUrl }) =>
            registerSvgPinIcon(mapInstance, name, dataUrl)
          )
        );

        iconResults.forEach((result, index) => {
          if (result.status === 'rejected') {
            console.error(
              `Pin ikonu yüklenemedi: ${PIN_ICON_IMAGES[index].name}`,
              result.reason
            );
          }
        });

        if (map.current === mapInstance) {
          setMapLoaded(true);
        }
      })();
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

  // Pinler: MapLibre GeoJSON clustering (DOM marker yerine GPU katmanları)
  useEffect(() => {
    const mapInstance = map.current;
    if (!mapInstance || !mapLoaded || mapInstance.getSource(PIN_SOURCE_ID)) return;

    mapInstance.addSource(PIN_SOURCE_ID, {
      type: 'geojson',
      data: pinFeatureCollection,
      cluster: true,
      clusterMaxZoom: 14,
      clusterRadius: 50,
    });

    // Yakın pinleri bir küme dairesi olarak çiz.
    mapInstance.addLayer({
      id: PIN_CLUSTER_LAYER_ID,
      type: 'circle',
      source: PIN_SOURCE_ID,
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': [
          'step',
          ['get', 'point_count'],
          '#60a5fa',
          10,
          '#3b82f6',
          50,
          '#1e40af',
        ],
        'circle-radius': [
          'step',
          ['get', 'point_count'],
          18,
          10,
          23,
          50,
          29,
        ],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
      },
    });

    // Kümenin içindeki pin sayısını göster.
    mapInstance.addLayer({
      id: PIN_CLUSTER_COUNT_LAYER_ID,
      type: 'symbol',
      source: PIN_SOURCE_ID,
      filter: ['has', 'point_count'],
      layout: {
        'text-field': ['get', 'point_count_abbreviated'],
        'text-font': ['Open Sans Semibold'],
        'text-size': 12,
        'text-allow-overlap': true,
      },
      paint: {
        'text-color': '#ffffff',
      },
    });

    // Küme dışında kalan tek pinleri renkli, harfli damla ikonlarıyla çiz.
    mapInstance.addLayer({
      id: PIN_POINT_LAYER_ID,
      type: 'symbol',
      source: PIN_SOURCE_ID,
      filter: ['!', ['has', 'point_count']],
      layout: {
        'icon-image': [
          'case',
          ['==', ['get', 'is_telegram'], true],
          'pin-radar',
          [
            'match',
            ['get', 'category'],
            'YEŞİL',
            'pin-yesil',
            'MAVİ',
            'pin-mavi',
            'SARI',
            'pin-sari',
            'pin-kirmizi',
          ],
        ],
        'icon-anchor': 'bottom',
        'icon-size': 0.5,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    });

    const setPointerCursor = () => {
      mapInstance.getCanvas().style.cursor = 'pointer';
    };
    const resetCursor = () => {
      mapInstance.getCanvas().style.cursor = '';
    };

    for (const layerId of [
      PIN_CLUSTER_LAYER_ID,
      PIN_CLUSTER_COUNT_LAYER_ID,
      PIN_POINT_LAYER_ID,
    ]) {
      mapInstance.on('mouseenter', layerId, setPointerCursor);
      mapInstance.on('mouseleave', layerId, resetCursor);
    }

    mapInstance.on('click', (event) => {
      // Cluster click: zoom to the cluster expansion level.
      const clusterFeatures = mapInstance.queryRenderedFeatures(event.point, {
        layers: [PIN_CLUSTER_LAYER_ID],
      });
      const clusterFeature = clusterFeatures[0];

      if (clusterFeature) {
        const clusterId = Number(clusterFeature.properties?.cluster_id);
        const geometry = clusterFeature.geometry;
        const source = mapInstance.getSource(PIN_SOURCE_ID) as
          | maplibregl.GeoJSONSource
          | undefined;

        if (
          source &&
          Number.isFinite(clusterId) &&
          geometry.type === 'Point'
        ) {
          const center = geometry.coordinates as [number, number];
          void source
            .getClusterExpansionZoom(clusterId)
            .then((zoom) => {
              if (map.current !== mapInstance) return;
              mapInstance.easeTo({ center, zoom });
            })
            .catch((error: unknown) => {
              console.error('Küme yakınlaştırılamadı:', error);
            });
        }
        return;
      }

      // Single pin click: pass the original pin object to the existing selection flow.
      const pinFeatures = mapInstance.queryRenderedFeatures(event.point, {
        layers: [PIN_POINT_LAYER_ID],
      });
      const pinId = pinFeatures[0]?.properties?.pin_id;

      if (pinId != null) {
        const selectedPin = pinsRef.current.find(
          (pin) => String(pin.id) === String(pinId)
        );
        if (selectedPin) onPinSelectRef.current(selectedPin);
        return;
      }

      // Only a click on empty map space should create a draft or pick a route point.
      onMapClickRef.current(event.lngLat.lat, event.lngLat.lng);
    });
  }, [mapLoaded, pinFeatureCollection]);

  // Update the existing GeoJSON source when the visible pin list changes.
  useEffect(() => {
    const mapInstance = map.current;
    if (!mapInstance || !mapLoaded) return;

    const source = mapInstance.getSource(PIN_SOURCE_ID) as
      | maplibregl.GeoJSONSource
      | undefined;
    if (!source) return;

    void source.setData(pinFeatureCollection).catch((error: unknown) => {
      console.error('Pin kaynağı güncellenemedi:', error);
    });
  }, [pinFeatureCollection, mapLoaded]);

  // Kullanıcının GPS konumu ayrı bir marker olarak kalır; pin clustering'e dahil edilmez.
  useEffect(() => {
    const mapInstance = map.current;
    if (!mapInstance || !mapLoaded) return;

    userMarker.current?.remove();
    userMarker.current = null;

    if (
      userPosition &&
      Number.isFinite(userPosition[0]) &&
      Number.isFinite(userPosition[1]) &&
      userPosition[0] >= -90 &&
      userPosition[0] <= 90 &&
      userPosition[1] >= -180 &&
      userPosition[1] <= 180
    ) {
      const userEl = document.createElement('div');
      userEl.style.width = '16px';
      userEl.style.height = '16px';
      userEl.style.borderRadius = '50%';
      userEl.style.backgroundColor = '#2785ff';
      userEl.style.border = '3px solid white';
      userEl.style.boxShadow = '0 0 0 4px rgba(39, 133, 255, 0.3)';

      userMarker.current = new maplibregl.Marker({ element: userEl })
        .setLngLat([userPosition[1], userPosition[0]])
        .addTo(mapInstance);
    }
  }, [userPosition, mapLoaded]);

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
          }, PIN_CLUSTER_LAYER_ID);

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
      }, PIN_CLUSTER_LAYER_ID);
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
        }, PIN_CLUSTER_LAYER_ID);
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
