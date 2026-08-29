import { FlightStatus } from '@/models/flight';

// In‑memory cache for the most recent successful flight list
let cachedFlights = [];

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { searchParams } = new URL(req.url, `http://${req.headers.host}`);
  const lat = parseFloat(searchParams.get('lat'));
  const lon = parseFloat(searchParams.get('lon'));
  const radius = parseFloat(searchParams.get('radius') ?? '10');

  if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return res.status(400).json({ error: 'Invalid lat/lon: must be valid numbers within range' });
  }
  if (isNaN(radius) || radius <= 0 || radius > 500) {
    return res.status(400).json({ error: 'Invalid radius: must be between 0 and 500 nautical miles' });
  }

  // Convert radius (nautical miles) to a latitude/longitude bounding box.
  const kmRadius = radius * 1.852;
  const degRadius = kmRadius / 111; // approx degrees latitude per km
  const latMin = lat - degRadius;
  const latMax = lat + degRadius;
  const lonMin = lon - degRadius;
  const lonMax = lon + degRadius;

  const url = `https://opensky-network.org/api/states/all?lamin=${latMin}&lamax=${latMax}&lomin=${lonMin}&lomax=${lonMax}`;

  // Helper to fetch from OpenSky with timeout and User-Agent
  async function fetchOpenSky(requestUrl) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    try {
      const resp = await fetch(requestUrl, {
        headers: {
          'User-Agent': 'flight-tracker/1.0 (+https://github.com/awiradarma/flight-tracker)'
        },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return resp;
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  }

  // Initial request
  let upstream = await fetchOpenSky(url);
  console.log('OpenSky response status:', upstream.status);
  // Simple retry on rate‑limit
  if (upstream.status === 429) {
    console.warn('OpenSky rate‑limit hit – retrying after 3 s');
    await new Promise(r => setTimeout(r, 3000));
    upstream = await fetchOpenSky(url);
    console.log('Retry response status:', upstream.status);
  }

  if (!upstream.ok) {
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
