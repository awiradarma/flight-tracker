import { useEffect, useState, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import SavedPlanesModal from './SavedPlanesModal';

// Helper component to recenter map only once on initial load
const RecenterMap = ({ lat, lng }) => {
  const map = useMap();
  const hasCentered = useRef(false);
  useEffect(() => {
    if (lat !== undefined && lng !== undefined && !hasCentered.current) {
      map.setView([lat, lng]);
      hasCentered.current = true;
    }
  }, [lat, lng, map]);
  return null;
};

const MapBoundsListener = ({ setRadius }) => {
  const radiusTimeout = useRef(null);
  const updateRadius = (newRadius) => {
    if (radiusTimeout.current) clearTimeout(radiusTimeout.current);
    radiusTimeout.current = setTimeout(() => {
      setRadius(Math.ceil(newRadius));
    }, 1000); // 1 second debounce
  };

  const map = useMapEvents({
    moveend: () => {
      const bounds = map.getBounds();
      const latDiff = Math.abs(bounds.getNorth() - bounds.getSouth());
      const lonDiff = Math.abs(bounds.getEast() - bounds.getWest());
      const approxNmPerDeg = 60; // 1 degree ≈ 60 nautical miles
      const radiusNm = Math.max(latDiff, lonDiff) * approxNmPerDeg / 2; // half span as radius
      updateRadius(radiusNm);
    },
    zoomend: () => {
      const bounds = map.getBounds();
      const latDiff = Math.abs(bounds.getNorth() - bounds.getSouth());
      const lonDiff = Math.abs(bounds.getEast() - bounds.getWest());
      const approxNmPerDeg = 60;
      const radiusNm = Math.max(latDiff, lonDiff) * approxNmPerDeg / 2;
      updateRadius(radiusNm);
    },
  });
  return null;
};

// Override Leaflet's default marker icons (they're now in /leaflet/)
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: '/leaflet/marker-icon.png',
  iconRetinaUrl: '/leaflet/marker-icon-2x.png',
  shadowUrl: '/leaflet/marker-shadow.png',
});

// Memoized aircraft icon with inline rotation via transform
const iconCache = {};
const aircraftIcon = (heading) => {
  const rounded = Math.round(heading || 0);
  if (iconCache[rounded]) return iconCache[rounded];
  const icon = L.divIcon({
    className: 'aircraft-icon',
    html: `<img src="/aircraft.svg" style="width:32px;height:32px;transform:rotate(${rounded}deg)" alt="aircraft" />`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -16],
  });
  iconCache[rounded] = icon;
  return icon;
};

// Throttle utility – ensures a function is called at most once every `limit` ms
function throttle(fn, limit) {
  let lastCall = 0;
  return (...args) => {
    const now = Date.now();
    if (now - lastCall >= limit) {
      lastCall = now;
      fn(...args);
    }
  };
}

// Centralised track fetch logic (sets track state)
const fetchTrack = async (icao24, setTrack) => {
  try {
    const r = await fetch(`/api/track?icao24=${icao24}`);
    const data = await r.json();
    if (!r.ok) {
      console.error('Track fetch error', data.error || r.status);
      return;
    }
    const coords = data.path ? data.path.map(p => [p[1], p[2]]) : [];
    setTrack(coords);
  } catch (e) {
    console.error('Track fetch exception', e);
  }
};

// Throttled version used in handlers
const throttledFetchTrack = throttle(fetchTrack, 2000);

export default function Map() {
  const [userPos, setUserPos] = useState(null);
  const [flights, setFlights] = useState([]);
  const [radius, setRadius] = useState(10); // nautical miles, will be updated from map bounds
  const [showSaved, setShowSaved] = useState(false);
  const [track, setTrack] = useState([]); // live track coordinates
  const watchId = useRef(null);

  // -------------------------------------------------------------
  // 1️⃣ Geolocation watch – keep user position up‑to‑date
  // -------------------------------------------------------------
  useEffect(() => {
    if (!navigator.geolocation) {
      // No geolocation support – use fallback (San Francisco)
      setUserPos({ lat: 37.7749, lng: -122.4194 });
      return;
    }
    // Get current position once to set initial location
    navigator.geolocation.getCurrentPosition(
      (pos) => setUserPos({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => {
        console.warn('Geolocation init error', err);
        // Fallback only if we don't have a position yet
        setUserPos({ lat: 37.7749, lng: -122.4194 });
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
    // Then watch for changes
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => setUserPos({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => {
        console.warn('Geolocation watch error', err);
        // Do not overwrite an existing valid position on watch errors
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    );
    return () => {
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    };
  }, []);

  // -------------------------------------------------------------
  // 2️⃣ Fetch flights with backoff and visibility awareness
  // -------------------------------------------------------------
  useEffect(() => {
    if (!userPos) return;
    const controller = new AbortController();
    let timeoutId = null;
    let consecutiveErrors = 0;

    const fetchDirectOpenSky = async (lat, lon, radNm, signal) => {
      const kmRadius = radNm * 1.852;
      const degRadius = kmRadius / 111;
      const latMin = lat - degRadius;
      const latMax = lat + degRadius;
      const lonMin = lon - degRadius;
      const lonMax = lon + degRadius;
      const url = `https://opensky-network.org/api/states/all?lamin=${latMin}&lamax=${latMax}&lomin=${lonMin}&lomax=${lonMax}`;
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`Direct OpenSky error: ${res.status}`);
      const raw = await res.json();
      const list = raw.states || [];
      return list.map(item => ({
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
    };

    const fetchFlights = async () => {
      if (document.hidden) return; // skip when tab not visible
      try {
        let flightList = [];
        try {
          const res = await fetch(
            `/api/flights?lat=${userPos.lat}&lon=${userPos.lng}&radius=${radius}`,
            { signal: controller.signal },
          );
          if (res.ok) {
            const data = await res.json();
            // If the server proxy returned real data (not fallback demo)
            if (Array.isArray(data) && !data.some(d => d.id === 'sample1')) {
              flightList = data;
            }
          }
        } catch (serverErr) {
          console.warn('Server API failed, falling back to direct client fetch', serverErr);
        }

        // If server was blocked / returned DEMO, fetch directly from browser
        if (flightList.length === 0) {
          flightList = await fetchDirectOpenSky(userPos.lat, userPos.lng, radius, controller.signal);
        }

        setFlights(flightList);
        consecutiveErrors = 0; // reset on success
      } catch (e) {
        if (e && e.name !== 'AbortError') {
          console.error('Failed to fetch flights:', e);
          consecutiveErrors++;
        }
      }
    };

    fetchFlights();
    // Base interval 12s, with exponential backoff on errors (max 60s)
    const getInterval = () => Math.min(12000 * Math.pow(2, consecutiveErrors), 60000);
    const scheduleNext = () => {
      timeoutId = setTimeout(() => {
        fetchFlights().then(scheduleNext);
      }, getInterval());
    };
    scheduleNext();

    const handleVisibility = () => {
      if (!document.hidden) fetchFlights(); // refresh when tab becomes visible
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      controller.abort();
      if (timeoutId) clearTimeout(timeoutId);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [userPos, radius]);

  // -------------------------------------------------------------
  // 3️⃣ Render map
  // -------------------------------------------------------------
  const defaultCenter = [37.7749, -122.4194];
  const center = userPos ? [userPos.lat, userPos.lng] : defaultCenter;
  return (
    <MapContainer
      center={center}
      zoom={13}
      style={{ height: '100vh', width: '100vw' }}
      scrollWheelZoom={true}
    >
      <RecenterMap lat={userPos?.lat} lng={userPos?.lng} />
      <MapBoundsListener setRadius={setRadius} />
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution="&copy; <a href='https://openstreetmap.org'>OpenStreetMap</a> contributors"
      />
      {/* Saved planes button */}
      <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 1000 }}>
        <button onClick={() => setShowSaved(true)} style={{ padding: '6px 12px' }} aria-label="View saved planes">Saved Planes</button>
      </div>
      <SavedPlanesModal isOpen={showSaved} onClose={() => setShowSaved(false)} />
      {track.length > 0 && <Polyline positions={track} color="blue" />}
      {userPos && (
        <Marker position={[userPos.lat, userPos.lng]}>
          <Popup>You are here</Popup>
        </Marker>
      )}
      {flights.map((f) => (
        <Marker
          key={f.id}
          position={[f.latitude, f.longitude]}
          icon={aircraftIcon(f.trueHeadingDeg)}
          eventHandlers={{
            click: () => throttledFetchTrack(f.icao24, setTrack),
          }}
        >
          <Popup>
            <div>
              <strong>{f.flightNumber || f.icao24}</strong>
              <br />
              Alt: {Math.round(f.altitudeFeet)} ft
              <br />
              Spd: {Math.round(f.groundSpeedKts)} kt
              <br />
              {f.isMilitary && <span style={{ color: 'red' }}>Military</span>}
              <br />
              <button onClick={(e) => {
                e.stopPropagation();
                const saved = JSON.parse(window.localStorage.getItem('savedPlanes') || '[]');
                if (saved.some(s => s.icao24 === f.icao24)) return; // prevent duplicates
                saved.push({ icao24: f.icao24, flightNumber: f.flightNumber || f.icao24, timestamp: Math.floor(Date.now() / 1000) });
                window.localStorage.setItem('savedPlanes', JSON.stringify(saved));
              }}>Save plane</button>
              <br />
              <button onClick={(e) => {
                e.stopPropagation();
                throttledFetchTrack(f.icao24, setTrack);
              }}>Show live track</button>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
