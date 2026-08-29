# ✈️ Flight Tracker

Real-time aircraft tracking application built with Next.js and Leaflet, powered by the OpenSky Network API.

## Features

- **Live flight map** — Aircraft positions updated every 12 seconds
- **Geolocation-based** — Auto-centres on your location
- **Dynamic radius** — Adjusts query area as you pan and zoom
- **Flight tracks** — Click any aircraft to see its live flight path
- **Save favourites** — Bookmark planes to localStorage for quick access
- **Flight details** — View departure/arrival info for saved flights

## Tech Stack

- **Next.js 13** (Pages Router)
- **React 18**
- **Leaflet** / react-leaflet
- **Tailwind CSS**
- **OpenSky Network API** (OAuth2 client credentials)

## Getting Started

### Prerequisites

- Node.js 18+
- An [OpenSky Network](https://opensky-network.org/) account with API client credentials

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

3. Create a `.env.local` file with your OpenSky credentials:
   ```env
   OPENSKY_CLIENT_ID=your-client-id
   OPENSKY_CLIENT_SECRET=your-client-secret
   ```

4. Start the development server:
   ```bash
   npm run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000) in your browser.

## API Routes

| Route | Description |
|-------|-------------|
| `GET /api/flights?lat=&lon=&radius=` | Fetch live flights within a bounding box |
| `GET /api/flightDetail?icao24=&timestamp=` | Fetch flight details for a saved aircraft |
| `GET /api/track?icao24=` | Fetch the live track/path for an aircraft |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENSKY_CLIENT_ID` | Yes | OpenSky API OAuth2 client ID |
| `OPENSKY_CLIENT_SECRET` | Yes | OpenSky API OAuth2 client secret |

## License

ISC
