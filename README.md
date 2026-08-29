# ✈️ Flight Tracker

Real-time aircraft tracking application built with Next.js and Leaflet. Live ADS-B data is sourced primarily from [adsb.lol](https://adsb.lol/) with an automatic fallback to the OpenSky Network API.

## Features

- **Live flight map** — Aircraft positions updated every 12 seconds with exponential backoff on errors
- **Geolocation-based** — Auto-centres on your location via `watchPosition()`
- **Dynamic radius** — Query area adjusts automatically as you pan and zoom
- **Live breadcrumb trails** — Tracks the last 40 position points of any selected aircraft
- **Aircraft categorisation** — Classifies flights as Commercial ✈️, Military 🎖️, or Private 🛩️
- **Filter & search** — Filter by category; search by flight number, tail number, ICAO hex, or aircraft type
- **Flight details** — Click any aircraft to see airline name, aircraft model, tail number, altitude, speed, and heading
- **Save favourites** — Bookmark planes to `localStorage` and look up their details later
- **Resilient data pipeline** — Falls back from adsb.lol → OpenSky → in-memory cache → demo plane

## Tech Stack

- **Next.js 13** (Pages Router)
- **React 18**
- **Leaflet** / react-leaflet
- **Tailwind CSS**
- **[adsb.lol](https://adsb.lol/)** — Primary live ADS-B data source (no credentials required)
- **[adsbdb.com](https://www.adsbdb.com/)** — Aircraft & airline lookup (no credentials required)
- **[OpenSky Network](https://opensky-network.org/)** — Fallback live data + historical track endpoint (optional OAuth2 credentials)

## Getting Started

### Prerequisites

- Node.js 18+
- *(Optional)* An [OpenSky Network](https://opensky-network.org/) account with API client credentials — only required for the `/api/track` historical path endpoint and as a fallback data source if adsb.lol is unavailable.

### Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/awiradarma/flight-tracker.git
   cd flight-tracker
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. *(Optional)* Create a `.env.local` file with your OpenSky credentials:
   ```env
   OPENSKY_CLIENT_ID=your-client-id
   OPENSKY_CLIENT_SECRET=your-client-secret
   ```

4. Start the development server:
   ```bash
   npm run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Cloudflare Pages Deployment

All API routes run on the **Cloudflare Edge Runtime** (`runtime: 'edge'`).

```bash
# Build for Cloudflare Pages
npm run pages:build

# Preview locally with Wrangler
npm run preview
```

Set the environment variables (`OPENSKY_CLIENT_ID`, `OPENSKY_CLIENT_SECRET`) in your Cloudflare Pages project settings if you want OpenSky fallback and historical track support.

## API Routes

All routes are edge-compatible and return JSON.

| Route | Query Params | Description |
|-------|-------------|-------------|
| `GET /api/flights` | `lat`, `lon`, `radius` (NM) | Live aircraft within the given radius. Primary: adsb.lol. Fallback: OpenSky. |
| `GET /api/flightDetail` | `icao24`, `callsign`, `lat` *(opt)*, `lon` *(opt)* | Airline name, aircraft model/registration, and origin→destination route via adsbdb.com. |
| `GET /api/track` | `icao24` | Historical flight path from OpenSky Network (requires credentials). |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENSKY_CLIENT_ID` | Optional | OpenSky API OAuth2 client ID. Enables fallback live data and the `/api/track` endpoint. |
| `OPENSKY_CLIENT_SECRET` | Optional | OpenSky API OAuth2 client secret. |

## License

ISC
