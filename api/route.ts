import type { VercelRequest, VercelResponse } from '@vercel/node';

type RouteRequest = {
  coordinates: [[number, number], [number, number]];
  profile?: string;
};

interface ORSResponse {
  features?: Array<{
    geometry: { coordinates: number[][] };
    properties: {
      summary: { distance: number; duration: number };
    };
  }>;
  error?: { message: string } | string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS Ayarları (Surge'dan gelen isteklere izin ver)
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // OPTIONS isteği (Tarayıcı ön kontrolü) ise hemen başarılı dön
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  const body = req.body as RouteRequest;
  if (!body || !Array.isArray(body.coordinates) || body.coordinates.length !== 2) {
    return res.status(400).json({ error: 'Invalid route request body' });
  }

  const apiKey = process.env.ORS_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ORS_API_KEY yapılandırılmamış.' });
  }

  const [start, end] = body.coordinates;
  const profile = body.profile || 'driving-car';

  // ORS'nin yeni API adresi: api.heigit.org
  const url = `https://api.heigit.org/v2/directions/${profile}/geojson`;

  try {
    const orsResponse = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json, application/geo+json'
      },
      body: JSON.stringify({
        coordinates: [[start[0], start[1]], [end[0], end[1]]]
      })
    });

    if (!orsResponse.ok) {
      const errorText = await orsResponse.text();
      console.error('ORS Error Response:', orsResponse.status, errorText);
      return res.status(orsResponse.status).json({ error: `ORS HTTP ${orsResponse.status}: ${errorText}` });
    }

    const data: ORSResponse = await orsResponse.json();
    
    if (!data.features || data.features.length === 0) {
      return res.status(404).json({ error: 'ORS geçerli bir rota döndürmedi.' });
    }

    const route = data.features[0];
    
    // ORS verisini, mevcut frontend'in (OSRM formatı) beklediği yapıya dönüştürüyoruz
    const formattedData = {
      routes: [{
        geometry: route.geometry,
        distance: route.properties.summary.distance,
        duration: route.properties.summary.duration
      }]
    };

    return res.status(200).json(formattedData);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('ORS proxy request failed:', errorMessage);
    return res.status(502).json({ error: 'Route request failed' });
  }
}