// pages/api/flightDetail.js
import fetch from 'node-fetch';

/**
 * GET /api/flightDetail?icao24=XXXXXX&timestamp=UNIX_SECONDS
 * Returns detailed flight information (departure/arrival airports) for a saved aircraft.
 * Uses OpenSky "flights/aircraft" endpoint which provides estDepartureAirport and estArrivalAirport.
 */
export default async function handler(req, res) {
  const { icao24, timestamp } = req.query;
  if (!icao24 || !timestamp) {
    return res.status(400).json({ error: 'Missing required query parameters icao24 and timestamp' });
  }
  const ts = Number(timestamp);
  if (isNaN(ts)) {
    return res.status(400).json({ error: 'Invalid timestamp' });
  }
  // Search a +-5 minute window around the supplied timestamp
  const begin = ts - 300;
  const end = ts + 300;
  const url = `https://opensky-network.org/api/flights/aircraft?icao24=${icao24}&begin=${begin}&end=${end}`;
  console.log('Fetching flight details from OpenSky:', url);
  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      console.error('OpenSky flight detail error', resp.status, await resp.text());
      return res.status(502).json({ error: 'Failed to fetch flight details from OpenSky' });
    }
    const data = await resp.json();
    if (!Array.isArray(data) || data.length === 0) {
      return res.status(404).json({ error: 'No flight record found for given parameters' });
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
    return res.status(200).json(result);
  } catch (err) {
    console.error('Error fetching flight detail', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
