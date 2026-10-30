import React, { useEffect, useRef } from 'react';
import { Map as MapLibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

export const MapIsometric3D: React.FC = () => {
  const mapContainer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mapContainer.current) return;

    const map = new MapLibreMap({
      container: mapContainer.current,
      center: [28.89919, 41.05012], // Bayrampaşa/Kocatepe
      zoom: 16.5,
      pitch: 60,
      bearing: -20,
      style: {
        version: 8,
        sources: {
          openfreemap: {
            type: 'vector',
            url: 'https://tiles.openfreemap.org/planet'
          }
        },
        layers: [
          { id: 'background', type: 'background', paint: { 'background-color': '#e0f2fe' } },
          { id: 'landuse', type: 'fill', source: 'openfreemap', 'source-layer': 'landuse', paint: { 'fill-color': '#fef3c7', 'fill-opacity': 0.8 } },
          { id: 'parks', type: 'fill', source: 'openfreemap', 'source-layer': 'park', paint: { 'fill-color': '#86efac' } },
          { id: 'roads', type: 'line', source: 'openfreemap', 'source-layer': 'transportation', paint: { 'line-color': '#ffffff', 'line-width': 4 } },
          {
            id: '3d-buildings',
            type: 'fill-extrusion',
            source: 'openfreemap',
            'source-layer': 'building',
            minzoom: 13,
            paint: {
              'fill-extrusion-color': [
                'interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 10],
                0, '#bfdbfe', 15, '#fbcfe8', 40, '#fef08a'
              ],
              'fill-extrusion-height': ['coalesce', ['get', 'render_height'], ['*', ['get', 'levels'], 3.5], 12],
              'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
              'fill-extrusion-opacity': 0.9
            }
          }
        ]
      }
    });

    return () => map.remove();
  }, []);

  return <div ref={mapContainer} style={{ width: '100%', height: '100%', borderRadius: '18px' }} />;
};
