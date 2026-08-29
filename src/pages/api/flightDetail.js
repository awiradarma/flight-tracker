export const config = {
  runtime: 'edge',
};

// In-memory cache for flight details and routes
const detailsCache = new Map();

export default async function handler(req) {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const urlObj = new URL(req.url);
  const icao24 = (urlObj.searchParams.get('icao24') || '').toLowerCase().trim();
  const callsign = (urlObj.searchParams.get('callsign') || '').trim();

  if (!icao24 && !callsign) {
    return new Response(JSON.stringify({ error: 'icao24 or callsign parameter required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const cacheKey = `${icao24}_${callsign}`;
  if (detailsCache.has(cacheKey)) {
    const cached = detailsCache.get(cacheKey);
    if (Date.now() - cached.timestamp < 120_000) { // 2 min cache
      return new Response(JSON.stringify(cached.data), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  let routeInfo = null;
  let aircraftInfo = null;

  // 1. Fetch flight route & airline info if callsign is available
  if (callsign) {
    try {
      const cleanCallsign = callsign.replace(/\s+/g, '');
      const routeCtrl = new AbortController();
      const routeTimeout = setTimeout(() => routeCtrl.abort(), 4000);
      const routeResp = await fetch(`https://api.adsbdb.com/v0/callsign/${cleanCallsign}`, {
        headers: { 'User-Agent': 'flight-tracker/1.0' },
        signal: routeCtrl.signal,
      });
      clearTimeout(routeTimeout);
      if (routeResp.ok) {
        const routeData = await routeResp.json();
        if (routeData?.response?.flightroute) {
          routeInfo = routeData.response.flightroute;
        }
      }
    } catch (e) {
      console.warn('Route lookup failed:', e.message);
    }
  }

  // 2. Fetch aircraft details (manufacturer, model, registration) by hex/icao24
  if (icao24 && /^[0-9a-f]{6}$/i.test(icao24)) {
    try {
      const acCtrl = new AbortController();
      const acTimeout = setTimeout(() => acCtrl.abort(), 4000);
      const acResp = await fetch(`https://api.adsbdb.com/v0/aircraft/${icao24}`, {
        headers: { 'User-Agent': 'flight-tracker/1.0' },
        signal: acCtrl.signal,
      });
      clearTimeout(acTimeout);
      if (acResp.ok) {
        const acData = await acResp.json();
        if (acData?.response?.aircraft) {
          aircraftInfo = acData.response.aircraft;
        }
      }
    } catch (e) {
      console.warn('Aircraft lookup failed:', e.message);
    }
  }

  // 3. Synthesize result
  const result = {
    icao24,
    callsign: callsign || null,
    airline: routeInfo?.airline ? {
      name: routeInfo.airline.name,
      iata: routeInfo.airline.iata,
      icao: routeInfo.airline.icao,
      callsign: routeInfo.airline.callsign,
    } : null,
    aircraft: aircraftInfo ? {
      type: aircraftInfo.type,
      icaoType: aircraftInfo.icao_type,
      manufacturer: aircraftInfo.manufacturer,
      registration: aircraftInfo.registration,
      registeredOwner: aircraftInfo.registered_owner,
      country: aircraftInfo.registered_owner_country_name,
    } : null,
    departure: routeInfo?.origin ? {
      iata: routeInfo.origin.iata_code || null,
      icao: routeInfo.origin.icao_code || null,
      name: routeInfo.origin.name || null,
      municipality: routeInfo.origin.municipality || null,
      country: routeInfo.origin.country_name || null,
      latitude: routeInfo.origin.latitude || null,
      longitude: routeInfo.origin.longitude || null,
    } : null,
    arrival: routeInfo?.destination ? {
      iata: routeInfo.destination.iata_code || null,
      icao: routeInfo.destination.icao_code || null,
      name: routeInfo.destination.name || null,
      municipality: routeInfo.destination.municipality || null,
      country: routeInfo.destination.country_name || null,
      latitude: routeInfo.destination.latitude || null,
      longitude: routeInfo.destination.longitude || null,
    } : null,
  };

  // Evict cache if too large
  if (detailsCache.size > 500) {
    detailsCache.clear();
  }
  detailsCache.set(cacheKey, { data: result, timestamp: Date.now() });

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, max-age=0'
    },
  });
}
