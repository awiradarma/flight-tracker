import { FlightStatus } from '@/models/flight';

export const config = {
  runtime: 'edge',
};

// In‑memory cache for the most recent successful flight list
let cachedFlights = [];

export default async function handler(req) {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const urlObj = new URL(req.url);
    const lat = parseFloat(urlObj.searchParams.get('lat'));
    const lon = parseFloat(urlObj.searchParams.get('lon'));
    const radius = parseFloat(urlObj.searchParams.get('radius') ?? '10');

    if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return new Response(JSON.stringify({ error: 'Invalid lat/lon: must be valid numbers within range' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (isNaN(radius) || radius <= 0 || radius > 500) {
      return new Response(JSON.stringify({ error: 'Invalid radius: must be between 0 and 500 nautical miles' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Convert radius (nautical miles) to a latitude/longitude bounding box.
    const kmRadius = radius * 1.852;
    const degRadius = kmRadius / 111; // approx degrees latitude per km
    const latMin = lat - degRadius;
    const latMax = lat + degRadius;
    const lonMin = lon - degRadius;
    const lonMax = lon + degRadius;

    const url = `https://opensky-network.org/api/states/all?lamin=${latMin}&lamax=${latMax}&lomin=${lonMin}&lomax=${lonMax}`;

    const headers = {
      'User-Agent': 'flight-tracker/1.0 (+https://github.com/awiradarma/flight-tracker)'
    };

    if (process.env.OPENSKY_CLIENT_ID && process.env.OPENSKY_CLIENT_SECRET) {
      headers['Authorization'] = 'Basic ' + Buffer.from(
        `${process.env.OPENSKY_CLIENT_ID}:${process.env.OPENSKY_CLIENT_SECRET}`
      ).toString('base64');
    }

    // Helper to fetch from OpenSky with timeout and User-Agent
    async function fetchOpenSky(requestUrl) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      try {
        const resp = await fetch(requestUrl, {
          headers,
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        return resp;
      } catch (err) {
        clearTimeout(timeoutId);
        throw err;
      }
    }

    let upstream;
    try {
      upstream = await fetchOpenSky(url);
    } catch (err) {
      console.warn('OpenSky direct fetch error/timeout:', err.message);
    }

    // Simple retry on rate‑limit if we got a 429
    if (upstream && upstream.status === 429) {
      console.warn('OpenSky rate‑limit hit – retrying after 2 s');
      await new Promise(r => setTimeout(r, 2000));
      try {
        upstream = await fetchOpenSky(url);
      } catch (err) {
        console.warn('OpenSky retry fetch error:', err.message);
      }
    }

    if (!upstream || !upstream.ok) {
      if (cachedFlights.length > 0) {
        console.warn('OpenSky request failed – serving cached flights');
        return new Response(JSON.stringify(cachedFlights), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
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
      return new Response(JSON.stringify(sampleFlights), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
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

    return new Response(JSON.stringify(flights), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Unhandled error in flights API:', error);
    if (cachedFlights.length > 0) {
      return new Response(JSON.stringify(cachedFlights), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ error: 'Failed to fetch flights' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
