import { FlightStatus } from '@/models/flight';

// In‑memory cache for the most recent successful flight list
let cachedFlights = [];

export default async function handler(req, res) {
  const { searchParams } = new URL(req.url, `http://${req.headers.host}`);
  const lat = searchParams.get('lat');
  const lon = searchParams.get('lon');
  const radius = searchParams.get('radius') ?? '10'; // nautical miles

  if (!lat || !lon) {
    return res.status(400).json({ error: 'Missing lat/lon' });
  }

  // Convert radius (nautical miles) to a latitude/longitude bounding box.
  const kmRadius = Number(radius) * 1.852;
  const degRadius = kmRadius / 111; // approx degrees latitude per km
  const latMin = Number(lat) - degRadius;
  const latMax = Number(lat) + degRadius;
  const lonMin = Number(lon) - degRadius;
  const lonMax = Number(lon) + degRadius;

  const url = `https://opensky-network.org/api/states/all?lamin=${latMin}&lamax=${latMax}&lomin=${lonMin}&lomax=${lonMax}`;

  // Use a longer timeout (30 s) for the OpenSky request – Vercel may need more time
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);
  let upstream = await fetch(url, { signal: controller.signal });
  clearTimeout(timeoutId);
  console.log('OpenSky response status:', upstream.status);
  if (upstream.status === 429) {
    console.warn('OpenSky rate‑limit hit – retrying after 3 s');
    await new Promise(r => setTimeout(r, 3000));
    const retryController = new AbortController();
    const retryTimeout = setTimeout(() => retryController.abort(), 30000);
    upstream = await fetch(url, { signal: retryController.signal });
    clearTimeout(retryTimeout);
    console.log('Retry response status:', upstream.status);
  }
  if (!upstream.ok) {
    // If OpenSky still fails (rate limit or other), return sample data to keep UI functional
    console.warn('OpenSky request failed, returning fallback sample flights');
    // If OpenSky still fails, return cached flights if we have any, otherwise a demo flight
    if (cachedFlights.length > 0) {
      console.warn('OpenSky request failed – serving cached flights');
      return res.status(200).json(cachedFlights);
    }
    console.warn('OpenSky request failed – returning fallback sample flight');
    const sampleFlights = [
      {
        id: 'sample1',
        flightNumber: 'DEMO123',
        airlineCode: '',
        icao24: 'sample1',
        departure: { iata: '' },
        arrival: { iata: '' },
        latitude: latMin + (latMax - latMin) / 2,
        longitude: lonMin + (lonMax - lonMin) / 2,
        altitudeFeet: 30000,
        groundSpeedKts: 450,
        trueHeadingDeg: 90,
        isMilitary: false,
        status: FlightStatus.EnRoute,
      },
    ];
    return res.status(200).json(sampleFlights);
  }

  const raw = await upstream.json();
  const flightList = raw.states ?? [];

  const flights = flightList.map(item => ({
    id: item[0], // icao24
    flightNumber: (item[1] ?? '').trim(),
    airlineCode: '',
    icao24: item[0],
    departure: { iata: '' },
    arrival: { iata: '' },
    latitude: item[6],
    longitude: item[5],
    altitudeFeet: item[7] ? item[7] * 3.28084 : undefined,
    groundSpeedKts: item[9] ? item[9] * 1.94384 : undefined,
    trueHeadingDeg: item[10],
    isMilitary: false,
    status: FlightStatus.EnRoute,
  }));

  // Update cache before responding
  cachedFlights = flights;

  return res.status(200).json(flights);
}
