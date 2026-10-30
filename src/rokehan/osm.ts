export interface OSMBuildingFeature {
  id: number;
  coordinates: [number, number][];
  tags: Record<string, string>;
}

export interface OSMTreeFeature {
  coordinates: [number, number];
  tags: Record<string, string>;
}

export interface OSMRoadFeature {
  id: number;
  coordinates: [number, number][];
  tags: Record<string, string>;
}

export interface OSMViewportData {
  buildings: OSMBuildingFeature[];
  trees: OSMTreeFeature[];
  roads: OSMRoadFeature[];
  fetchedAt: number;
  bbox: [number, number, number, number];
}

type OverpassElement = {
  type: 'node' | 'way' | 'relation;
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  geometry?: { lat: number; lon: number }[];
  tags?: Record<string, string>;
};

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const cache = new Map<string, OSMViewportData>();
const CACHE_TTL = 5 * 60 * 1000;

function roundBbox(bbox: [number, number, number, number]): [number, number, number, number] {
  return bbox.map(value => Math.round(value * 10000) / 10000) as [number, number, number, number];
}

function cacheKey(bbox: [number, number, number, number]): string {
  return bbox.map(value => value.toFixed(4)).join(',');
}

/**
 * Fetch a small viewport-sized OSM extract. Coordinates are [longitude, latitude].
 * Closed building ways and individually mapped tree nodes are supported initially;
 * multipolygon relations are intentionally skipped until inner-ring handling is added.
 */
export async function fetchOSMViewport(
  inputBbox: [number, number, number, number],
  signal?: AbortSignal,
): Promise<OSMViewportData> {
  const bbox = roundBbox(inputBbox);
  const [south, west, north, east] = bbox;
  if (!(south < north && west < east) || north - south > 0.035 || east - west > 0.035) {
    throw new Error('OSM isteği geçersiz veya fazla geniş. Görünüm alanını yakınlaştırın.');
  }

  const key = cacheKey(bbox);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) return cached;

  const query = `[out:json][timeout:25];
(
  way["building"](${south},${west},${north},${east});
  node["natural"="tree"](${south},${west},${north},${east});
  node["natural"="tree_row"](${south},${west},${north},${east});
  way["highway"](${south},${west},${north},${east});
);
out body geom;`;

  let lastError: unknown;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: new URLSearchParams({ data: query }).toString(),
        signal: signal ?? AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new Error(`Overpass HTTP ${response.status}`);
      const payload = await response.json() as { elements?: OverpassElement[] };
      if (!Array.isArray(payload.elements)) throw new Error('Overpass yanıtı beklenen formatta değil.');

      const buildings: OSMBuildingFeature[] = [];
      const roads: OSMRoadFeature[] = [];
      const trees: OSMTreeFeature[] = [];

      for (const element of payload.elements) {
        const tags = element.tags ?? {};
        if (element.type === 'node' && Number.isFinite(element.lat) && Number.isFinite(element.lon)) {
          if (tags.natural === 'tree' || tags.natural === 'tree_row') {
            trees.push({ coordinates: [element.lon!, element.lat!], tags });
          }
          continue;
        }
        if (element.type !== 'way' || !element.geometry || element.geometry.length < 2) continue;
        const coordinates = element.geometry
          .filter(point => Number.isFinite(point.lon) && Number.isFinite(point.lat))
          .map(point => [point.lon, point.lat] as [number, number]);

        if (tags.building && coordinates.length >= 4 &&
            coordinates[0][0] === coordinates[coordinates.length - 1][0] &&
            coordinates[0][1] === coordinates[coordinates.length - 1][1]) {
          buildings.push({ id: element.id, coordinates, tags });
        } else if (tags.highway) {
          roads.push({ id: element.id, coordinates, tags });
        }
      }

      const result: OSMViewportData = { buildings, trees, roads, fetchedAt: Date.now(), bbox };
      cache.set(key, result);
      return result;
    } catch (error) {
      lastError = error;
      if (signal?.aborted) throw error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('OSM verisi alınamadı.');
}

/** Convert a MapLibre bounds object to the [south, west, north, east] tuple. */
export function boundsToOSMBbox(bounds: {
  getSouth(): number;
  getWest(): number;
  getNorth(): number;
  getEast(): number;
}): [number, number, number, number] {
  return [bounds.getSouth(), bounds.getWest(), bounds.getNorth(), bounds.getEast()];
}
