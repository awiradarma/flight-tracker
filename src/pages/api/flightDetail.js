export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const urlObj = new URL(req.url);
  const icao24 = urlObj.searchParams.get('icao24');
  const timestamp = urlObj.searchParams.get('timestamp');

  if (!icao24 || !timestamp) {
    return new Response(JSON.stringify({ error: 'Missing required query parameters icao24 and timestamp' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!/^[0-9a-f]{6}$/i.test(icao24)) {
    return new Response(JSON.stringify({ error: 'Invalid icao24 format: must be 6-char hex string' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const ts = Number(timestamp);
  if (isNaN(ts)) {
    return new Response(JSON.stringify({ error: 'Invalid timestamp' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Search a +-5 minute window around the supplied timestamp
  const begin = ts - 300;
  const end = ts + 300;
  const url = `https://opensky-network.org/api/flights/aircraft?icao24=${icao24}&begin=${begin}&end=${end}`;
  console.log('Fetching flight details from OpenSky:', url);
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!resp.ok) {
      console.error('OpenSky flight detail error', resp.status, await resp.text());
      return new Response(JSON.stringify({ error: 'Failed to fetch flight details from OpenSky' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const data = await resp.json();
    if (!Array.isArray(data) || data.length === 0) {
      return new Response(JSON.stringify({ error: 'No flight record found for given parameters' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    // OpenSky may return multiple records; pick the one closest to the timestamp
    const closest = data.reduce((best, cur) => {
      const curTs = cur.firstSeen || 0;
      const bestTs = best.firstSeen || 0;
      return Math.abs(curTs - ts) < Math.abs(bestTs - ts) ? cur : best;
    }, data[0]);
    const result = {
      icao24: closest.icao24,
      callsign: closest.callsign?.trim() || null,
      departure: {
        iata: closest.estDepartureAirport || null,
        icao: null,
        name: null,
      },
      arrival: {
        iata: closest.estArrivalAirport || null,
        icao: null,
        name: null,
      },
      firstSeen: closest.firstSeen,
      lastSeen: closest.lastSeen,
    };
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Error fetching flight detail', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
