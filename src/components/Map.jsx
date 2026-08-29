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

// Centralised detail fetch
const fetchFlightDetail = async (flight, setDetail) => {
  try {
    const latParam = flight.latitude !== undefined ? `&lat=${flight.latitude}` : '';
    const lonParam = flight.longitude !== undefined ? `&lon=${flight.longitude}` : '';
    const r = await fetch(`/api/flightDetail?icao24=${flight.icao24}&callsign=${encodeURIComponent(flight.flightNumber || '')}${latParam}${lonParam}`);
    if (!r.ok) return;
    const data = await r.json();
    setDetail(data);
  } catch (e) {
    console.error('Flight detail fetch exception', e);
  }
};

export default function Map() {
  const [userPos, setUserPos] = useState(null);
  const [flights, setFlights] = useState([]);
  const [radius, setRadius] = useState(10); // nautical miles, will be updated from map bounds
  const [showSaved, setShowSaved] = useState(false);
  const [selectedFlight, setSelectedFlight] = useState(null);
  const [flightDetail, setFlightDetail] = useState(null);
  const [historyTracks, setHistoryTracks] = useState({}); // icao24 -> [[lat, lon], ...]
  const [filterType, setFilterType] = useState('all'); // 'all' | 'commercial' | 'military' | 'private'
  const [searchQuery, setSearchQuery] = useState('');
  const [isFilterExpanded, setIsFilterExpanded] = useState(false);
  const watchId = useRef(null);

  // -------------------------------------------------------------
  // 1️⃣ Geolocation watch – keep user position up‑to‑date
  // -------------------------------------------------------------
  useEffect(() => {
    if (!navigator.geolocation) {
      setUserPos({ lat: 37.7749, lng: -122.4194 });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => setUserPos({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => {
        console.warn('Geolocation init error', err);
        setUserPos({ lat: 37.7749, lng: -122.4194 });
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => setUserPos({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => {
        console.warn('Geolocation watch error', err);
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

    const fetchFlights = async () => {
      if (document.hidden) return; // skip when tab not visible
      try {
        const res = await fetch(
          `/api/flights?lat=${userPos.lat}&lon=${userPos.lng}&radius=${radius}`,
          { signal: controller.signal },
        );
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        const data = await res.json();
        if (Array.isArray(data)) {
          setFlights(data);
          // Accumulate live breadcrumb trails for each aircraft
          setHistoryTracks(prev => {
            const next = { ...prev };
            data.forEach(f => {
              if (f.latitude && f.longitude) {
                const existing = next[f.icao24] || [];
                const last = existing[existing.length - 1];
                if (!last || last[0] !== f.latitude || last[1] !== f.longitude) {
                  next[f.icao24] = [...existing.slice(-40), [f.latitude, f.longitude]];
                }
              }
            });
            return next;
          });
          consecutiveErrors = 0;
        }
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
      if (!document.hidden) fetchFlights();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      controller.abort();
      if (timeoutId) clearTimeout(timeoutId);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [userPos, radius]);

  const handlePlaneSelect = (f) => {
    setSelectedFlight(f);
    setFlightDetail(null);
    fetchFlightDetail(f, setFlightDetail);
  };

  // Build route polyline points if departure and arrival coordinates exist
  const activeRoute = [];
  if (selectedFlight && flightDetail) {
    if (flightDetail.departure?.latitude && flightDetail.departure?.longitude) {
      activeRoute.push([flightDetail.departure.latitude, flightDetail.departure.longitude]);
    }
    if (selectedFlight.latitude && selectedFlight.longitude) {
      activeRoute.push([selectedFlight.latitude, selectedFlight.longitude]);
    }
    if (flightDetail.arrival?.latitude && flightDetail.arrival?.longitude) {
      activeRoute.push([flightDetail.arrival.latitude, flightDetail.arrival.longitude]);
    }
  }

  // Active breadcrumb history for selected aircraft
  const selectedBreadcrumbs = (selectedFlight && historyTracks[selectedFlight.icao24]) || [];

  // Filter flights by category & search query
  const displayedFlights = flights.filter(f => {
    // 1. Category Filter
    if (filterType === 'military' && !f.isMilitary) return false;
    if (filterType === 'commercial' && f.category !== 'commercial') return false;
    if (filterType === 'private' && f.category !== 'private') return false;

    // 2. Search Query Filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const matchNumber = (f.flightNumber || '').toLowerCase().includes(q);
      const matchHex = (f.icao24 || '').toLowerCase().includes(q);
      const matchType = (f.aircraftType || '').toLowerCase().includes(q);
      const matchReg = (f.registration || '').toLowerCase().includes(q);
      if (!matchNumber && !matchHex && !matchType && !matchReg) return false;
    }

    return true;
  });

  const militaryCount = flights.filter(f => f.isMilitary).length;
  const commercialCount = flights.filter(f => f.category === 'commercial').length;
  const privateCount = flights.filter(f => f.category === 'private').length;

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
      
      {/* Top Floating Control Bar (Search, Category Filters, Saved Planes) */}
      <div style={{ position: 'absolute', top: 10, left: 10, right: 10, zIndex: 1000, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', pointerEvents: 'none', gap: '8px' }}>
        {/* Left Side: Collapsible Filter / Search Pill */}
        <div style={{ pointerEvents: 'auto', background: 'rgba(255, 255, 255, 0.96)', borderRadius: '10px', boxShadow: '0 4px 14px rgba(0,0,0,0.18)', maxWidth: 'calc(100vw - 120px)', backdropFilter: 'blur(8px)', overflow: 'hidden' }}>
          {/* Header Row: Current active filter tag + Toggle button */}
          <div 
            onClick={() => setIsFilterExpanded(!isFilterExpanded)}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', cursor: 'pointer', userSelect: 'none' }}
          >
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#1e3a5f' }}>
              🔍 {filterType === 'all' ? `All (${flights.length})` : filterType === 'commercial' ? `✈️ Commercial (${commercialCount})` : filterType === 'military' ? `🎖️ Military (${militaryCount})` : `🛩️ Private (${privateCount})`}
            </span>
            <span style={{ fontSize: '11px', color: '#64748b', background: '#f1f5f9', padding: '2px 6px', borderRadius: '4px' }}>
              {isFilterExpanded ? '▲ Hide' : '▼ Filter'}
            </span>
          </div>

          {/* Expanded Drawer: Search Input & Category Filters */}
          {isFilterExpanded && (
            <div style={{ padding: '8px 10px 10px 10px', borderTop: '1px solid #f1f5f9', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <input
                type="text"
                placeholder="Search flight / tail / type..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ padding: '6px 8px', fontSize: '12px', border: '1px solid #cbd5e1', borderRadius: '6px', outline: 'none', width: '100%', boxSizing: 'border-box' }}
              />

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                <button
                  onClick={() => setFilterType('all')}
                  style={{
                    padding: '4px 8px',
                    fontSize: '11px',
                    fontWeight: 600,
                    borderRadius: '4px',
                    border: 'none',
                    cursor: 'pointer',
                    background: filterType === 'all' ? '#1e3a5f' : '#f1f5f9',
                    color: filterType === 'all' ? '#ffffff' : '#334155',
                  }}
                >
                  All ({flights.length})
                </button>

                <button
                  onClick={() => setFilterType('commercial')}
                  style={{
                    padding: '4px 8px',
                    fontSize: '11px',
                    fontWeight: 600,
                    borderRadius: '4px',
                    border: 'none',
                    cursor: 'pointer',
                    background: filterType === 'commercial' ? '#2563eb' : '#f1f5f9',
                    color: filterType === 'commercial' ? '#ffffff' : '#334155',
                  }}
                >
                  ✈️ Commercial ({commercialCount})
                </button>

                <button
                  onClick={() => setFilterType('military')}
                  style={{
                    padding: '4px 8px',
                    fontSize: '11px',
                    fontWeight: 600,
                    borderRadius: '4px',
                    border: 'none',
                    cursor: 'pointer',
                    background: filterType === 'military' ? '#dc2626' : '#f1f5f9',
                    color: filterType === 'military' ? '#ffffff' : '#334155',
                  }}
                >
                  🎖️ Military ({militaryCount})
                </button>

                <button
                  onClick={() => setFilterType('private')}
                  style={{
                    padding: '4px 8px',
                    fontSize: '11px',
                    fontWeight: 600,
                    borderRadius: '4px',
                    border: 'none',
                    cursor: 'pointer',
                    background: filterType === 'private' ? '#0d9488' : '#f1f5f9',
                    color: filterType === 'private' ? '#ffffff' : '#334155',
                  }}
                >
                  🛩️ Private ({privateCount})
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right Side: Saved Planes */}
        <div style={{ pointerEvents: 'auto' }}>
          <button 
            onClick={() => setShowSaved(true)} 
            style={{ padding: '6px 12px', background: '#1e3a5f', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, boxShadow: '0 4px 12px rgba(0,0,0,0.2)', fontSize: '12px', whiteSpace: 'nowrap' }}
            aria-label="View saved planes"
          >
            ⭐ Saved ({JSON.parse(typeof window !== 'undefined' ? window.localStorage?.getItem('savedPlanes') || '[]' : '[]').length})
          </button>
        </div>
      </div>

      <SavedPlanesModal isOpen={showSaved} onClose={() => setShowSaved(false)} />
      
      {/* Live Breadcrumb Trail for Selected Aircraft */}
      {selectedBreadcrumbs.length > 1 && (
        <Polyline positions={selectedBreadcrumbs} color="#2563eb" weight={4} opacity={0.8} dashArray="4, 6" />
      )}

      {/* Origin -> Aircraft -> Destination Route Line */}
      {activeRoute.length > 1 && (
        <Polyline positions={activeRoute} color="#dc2626" weight={3} opacity={0.6} dashArray="8, 8" />
      )}

      {/* Origin Airport Marker */}
      {flightDetail?.departure?.latitude && (
        <Marker position={[flightDetail.departure.latitude, flightDetail.departure.longitude]}>
          <Popup>
            <div>
              <strong>Origin: {flightDetail.departure.name}</strong> ({flightDetail.departure.iata || flightDetail.departure.icao})
            </div>
          </Popup>
        </Marker>
      )}

      {/* Destination Airport Marker */}
      {flightDetail?.arrival?.latitude && (
        <Marker position={[flightDetail.arrival.latitude, flightDetail.arrival.longitude]}>
          <Popup>
            <div>
              <strong>Destination: {flightDetail.arrival.name}</strong> ({flightDetail.arrival.iata || flightDetail.arrival.icao})
            </div>
          </Popup>
        </Marker>
      )}

      {userPos && (
        <Marker position={[userPos.lat, userPos.lng]}>
          <Popup>You are here</Popup>
        </Marker>
      )}

      {displayedFlights.map((f) => (
        <Marker
          key={f.id}
          position={[f.latitude, f.longitude]}
          icon={aircraftIcon(f.trueHeadingDeg)}
          eventHandlers={{
            click: () => handlePlaneSelect(f),
          }}
        >
          <Popup>
            <div style={{ minWidth: '220px', lineHeight: '1.4' }}>
              <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#1e3a5f', marginBottom: '4px' }}>
                {f.flightNumber || f.icao24}
              </div>

              {selectedFlight?.id === f.id && flightDetail?.airline?.name && (
                <div style={{ color: '#2563eb', fontWeight: 600, fontSize: '13px', marginBottom: '4px' }}>
                  {flightDetail.airline.name}
                </div>
              )}

              {/* Route Summary if Available */}
              {selectedFlight?.id === f.id && (flightDetail?.departure || flightDetail?.arrival) && (
                <div style={{ background: '#f1f5f9', padding: '6px 8px', borderRadius: '4px', margin: '6px 0', fontSize: '12px' }}>
                  <div><strong>From:</strong> {flightDetail.departure?.name || flightDetail.departure?.iata || 'Unknown'}</div>
                  <div><strong>To:</strong> {flightDetail.arrival?.name || flightDetail.arrival?.iata || 'Unknown'}</div>
                </div>
              )}

              {/* Aircraft Model Details */}
              {selectedFlight?.id === f.id && flightDetail?.aircraft && (
                <div style={{ fontSize: '12px', color: '#475569', marginBottom: '4px' }}>
                  <strong>Aircraft:</strong> {flightDetail.aircraft.manufacturer} {flightDetail.aircraft.type || flightDetail.aircraft.icaoType}
                  {flightDetail.aircraft.registration && <span> ({flightDetail.aircraft.registration})</span>}
                </div>
              )}

              <div style={{ fontSize: '12px', color: '#334155' }}>
                <div><strong>Alt:</strong> {typeof f.altitudeFeet === 'number' ? Math.round(f.altitudeFeet).toLocaleString() : 'N/A'} ft</div>
                <div><strong>Speed:</strong> {typeof f.groundSpeedKts === 'number' ? Math.round(f.groundSpeedKts) : 'N/A'} kt</div>
                <div><strong>Heading:</strong> {Math.round(f.trueHeadingDeg || 0)}°</div>
                {f.isMilitary && <div style={{ color: '#dc2626', fontWeight: 'bold' }}>🎖️ Military Aircraft</div>}
              </div>

              <div style={{ marginTop: '8px', display: 'flex', gap: '6px' }}>
                <button
                  style={{ padding: '4px 8px', background: '#0284c7', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    const saved = JSON.parse(window.localStorage.getItem('savedPlanes') || '[]');
                    if (saved.some(s => s.icao24 === f.icao24)) return;
                    saved.push({
                      icao24: f.icao24,
                      flightNumber: f.flightNumber || f.icao24,
                      timestamp: Math.floor(Date.now() / 1000)
                    });
                    window.localStorage.setItem('savedPlanes', JSON.stringify(saved));
                  }}
                >
                  ⭐ Save plane
                </button>
              </div>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
