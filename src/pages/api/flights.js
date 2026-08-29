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

    const radiusNm = Math.min(Math.round(radius), 250);

    // Primary: Query adsb.lol (unfiltered community ADS-B, 100% cloud-friendly, zero rate-limit blocks)
    try {
      const adsbUrl = `https://api.adsb.lol/v2/point/${lat}/${lon}/${radiusNm}`;
      const adsbController = new AbortController();
      const adsbTimeout = setTimeout(() => adsbController.abort(), 6000);

      const adsbResp = await fetch(adsbUrl, {
        headers: {
          'User-Agent': 'flight-tracker/1.0 (https://github.com/awiradarma/flight-tracker)'
        },
        signal: adsbController.signal
      });
      clearTimeout(adsbTimeout);

      if (adsbResp.ok) {
        const adsbData = await adsbResp.json();
        const rawList = adsbData.ac || [];
        const flights = rawList
          .filter(ac => ac.lat !== undefined && ac.lon !== undefined)
          .map(ac => {
            const flight = (ac.flight || '').trim();
            const reg = (ac.r || '').trim();
            const isMil = Boolean((ac.dbFlags || 0) & 1);
            const isComm = Boolean(!isMil && flight && !flight.startsWith('N') && /^[A-Z]{2,4}\d+/.test(flight));
            let category = 'private';
            if (isMil) category = 'military';
            else if (isComm) category = 'commercial';

            return {
              id: ac.hex,
              flightNumber: flight || reg || ac.hex,
              registration: reg,
              airlineCode: '',
              icao24: ac.hex,
              aircraftType: ac.t || '',
              category, // 'military' | 'commercial' | 'private'
              departure: { iata: '' },
              arrival: { iata: '' },
              latitude: ac.lat,
              longitude: ac.lon,
              altitudeFeet: typeof ac.alt_baro === 'number' ? ac.alt_baro : (typeof ac.alt_geom === 'number' ? ac.alt_geom : undefined),
              groundSpeedKts: typeof ac.gs === 'number' ? ac.gs : undefined,
              trueHeadingDeg: typeof ac.track === 'number' ? ac.track : 0,
              isMilitary: isMil,
              status: 'EnRoute',
            };
          });

        cachedFlights = flights;
        return new Response(JSON.stringify(flights), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store, max-age=0'
          },
        });
      }
    } catch (adsbErr) {
      console.warn('adsb.lol query failed, attempting OpenSky fallback:', adsbErr.message);
    }

    // Secondary Fallback: OpenSky Network
    const kmRadius = radius * 1.852;
    const degRadius = kmRadius / 111;
    const latMin = lat - degRadius;
    const latMax = lat + degRadius;
    const lonMin = lon - degRadius;
    const lonMax = lon + degRadius;

    const openSkyUrl = `https://opensky-network.org/api/states/all?lamin=${latMin}&lamax=${latMax}&lomin=${lonMin}&lomax=${lonMax}`;
    const openSkyHeaders = {
      'User-Agent': 'flight-tracker/1.0 (+https://github.com/awiradarma/flight-tracker)'
    };
    if (process.env.OPENSKY_CLIENT_ID && process.env.OPENSKY_CLIENT_SECRET) {
      openSkyHeaders['Authorization'] = 'Basic ' + Buffer.from(
        `${process.env.OPENSKY_CLIENT_ID}:${process.env.OPENSKY_CLIENT_SECRET}`
      ).toString('base64');
    }

    try {
      const osController = new AbortController();
      const osTimeout = setTimeout(() => osController.abort(), 6000);
      const osResp = await fetch(openSkyUrl, {
        headers: openSkyHeaders,
        signal: osController.signal,
      });
      clearTimeout(osTimeout);

      if (osResp.ok) {
        const raw = await osResp.json();
        const flightList = raw.states || [];
        const flights = flightList.map(item => ({
          id: item[0],
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
          status: 'EnRoute',
        }));

        cachedFlights = flights;
        return new Response(JSON.stringify(flights), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    } catch (osErr) {
      console.warn('OpenSky fallback failed:', osErr.message);
    }

    if (cachedFlights.length > 0) {
      return new Response(JSON.stringify(cachedFlights), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Default sample flight if completely offline
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
        status: 'EnRoute',
      },
    ];
    return new Response(JSON.stringify(sampleFlights), {
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
