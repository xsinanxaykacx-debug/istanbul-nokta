// @ts-nocheck
/* eslint-disable */
type VercelRequest = { method?: string; body?: unknown };
type VercelResponse = { setHeader(name: string, value: string): void; status(code: number): VercelResponse; json(body: unknown): VercelResponse; send(body: string): VercelResponse };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body as any;
  if (!body || !Array.isArray(body.coordinates) || body.coordinates.length !== 2) {
    return res.status(400).json({ error: 'Invalid route request body' });
  }

  const [start, end] = body.coordinates;
  // Daha stabil olan genel OSRM sunucusunu kullanıyoruz.
  const url = `https://routing.openstreetmap.de/routed-car/route/v1/driving/${start[0]},${start[1]};${end[0]},${end[1]}?overview=full&geometries=geojson`;

  try {
    const osrmResponse = await fetch(url);
    if (!osrmResponse.ok) {
      // OSRM'den gelen hata mesajını konsola yazdıralım ki sorunu görebilelim.
      const errorText = await osrmResponse.text();
      console.error('OSRM Error Response:', osrmResponse.status, errorText);
      return res.status(osrmResponse.status).json({ error: `OSRM HTTP ${osrmResponse.status}: ${errorText}` });
    }
    const data = await osrmResponse.json();
    return res.status(200).json(data);
  } catch (error) {
    console.error('OSRM proxy request failed:', error);
    return res.status(502).json({ error: 'Route request failed' });
  }
}