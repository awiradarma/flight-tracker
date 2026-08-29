export const config = {
  runtime: 'edge',
};

// In‑memory token cache
let cachedToken = null; // { accessToken, expiresAt }

async function getAccessToken() {
  // Return cached token if still valid (with a small safety margin)
  if (cachedToken && cachedToken.expiresAt - Date.now() > 60_000) {
    return cachedToken.accessToken;
  }

  const clientId = process.env.OPENSKY_CLIENT_ID;
  if (!clientId) {
    console.error('OPENSKY_CLIENT_ID is not set');
    throw new Error('OpenSky client ID missing');
  }
  const clientSecret = process.env.OPENSKY_CLIENT_SECRET;
  if (!clientSecret) {
    console.error('OPENSKY_CLIENT_SECRET is not set');
    throw new Error('OpenSky client secret missing');
  }

  const tokenUrl =
    'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });

  const resp = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!resp.ok) {
    const txt = await resp.text();
    console.error('Failed to obtain OpenSky token', resp.status, txt);
    throw new Error('OpenSky token request failed');
  }
  const data = await resp.json();
  const expiresAt = Date.now() + data.expires_in * 1000;
  cachedToken = { accessToken: data.access_token, expiresAt };
  return cachedToken.accessToken;
}

// ---------- track cache (30 s) ----------
const trackCache = new Map(); // icao24 → { path, expiresAt }

async function getTrack(icao24, accessToken) {
  const cached = trackCache.get(icao24);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.path;
  }

  const url = `https://opensky-network.org/api/tracks/all?icao24=${icao24}&time=0`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!resp.ok) {
    // Let caller handle 429 / other errors
    const txt = await resp.text();
    console.error('OpenSky track request failed', resp.status, txt);
    throw new Error(`OpenSky track request failed (${resp.status})`);
  }

  const data = await resp.json();
  const path = data.path || [];

  // Evict expired entries if cache is getting large
  if (trackCache.size > 500) {
    const now = Date.now();
    for (const [key, val] of trackCache) {
      if (val.expiresAt < now) trackCache.delete(key);
    }
  }

  // cache for 30 seconds
  trackCache.set(icao24, { path, expiresAt: Date.now() + 30_000 });
  return path;
}

export default async function handler(req) {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const urlObj = new URL(req.url);
  const icao24 = urlObj.searchParams.get('icao24');

  if (!icao24) {
    return new Response(JSON.stringify({ error: 'Missing required icao24 parameter' }), {
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

  let accessToken;
  try {
    accessToken = await getAccessToken();
  } catch (e) {
    console.error('Token error', e);
    return new Response(JSON.stringify({ error: 'Failed to obtain OpenSky access token' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const path = await getTrack(icao24, accessToken);
    return new Response(JSON.stringify({ icao24, path }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    // If OpenSky returns 429 we simply forward it as a 502 for the client
    if (err.message.includes('429')) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    console.error('Error fetching track', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
