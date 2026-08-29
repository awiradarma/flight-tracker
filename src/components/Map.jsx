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

// Memoized aircraft icon with inline rotation via transform and custom color
const iconCache = {};
const aircraftIcon = (heading, isTracked = false) => {
  const rounded = Math.round(heading || 0);
  const cacheKey = `${rounded}_${isTracked ? 'tracked' : 'default'}`;
  if (iconCache[cacheKey]) return iconCache[cacheKey];

  const fillColor = isTracked ? '#f59e0b' : '#1e3a5f'; // Amber gold for tracked, navy blue for default
  const strokeColor = isTracked ? '#b45309' : '#0f1f33';
  const glowStyle = isTracked ? 'filter: drop-shadow(0 0 6px rgba(245, 158, 11, 0.9));' : 'filter: drop-shadow(0 1px 3px rgba(0,0,0,0.4));';

  const svgHtml = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="34" height="34" style="transform:rotate(${rounded}deg);${glowStyle}">
      <path d="M32 4 L36 28 L56 38 L56 42 L36 36 L36 52 L44 56 L44 60 L32 56 L20 60 L20 56 L28 52 L28 36 L8 42 L8 38 L28 28 Z" fill="${fillColor}" stroke="${strokeColor}" stroke-width="2" stroke-linejoin="round"/>
    </svg>
  `;

  const icon = L.divIcon({
    className: 'aircraft-icon',
    html: svgHtml,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -17],
  });
  iconCache[cacheKey] = icon;
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
  const [savedPlanes, setSavedPlanes] = useState([]);
  const watchId = useRef(null);

  // Load saved planes from localStorage on mount
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem('savedPlanes');
      if (raw) setSavedPlanes(JSON.parse(raw));
    } catch (e) {
      console.error('Failed to parse savedPlanes from localStorage', e);
    }
  }, []);

  const toggleTrackPlane = (flight) => {
    const icao = flight.icao24.toLowerCase();
    setSavedPlanes(prev => {
      const exists = prev.some(p => p.icao24.toLowerCase() === icao);
      let updated;
      if (exists) {
        updated = prev.filter(p => p.icao24.toLowerCase() !== icao);
      } else {
        updated = [
          {
            icao24: flight.icao24,
            flightNumber: flight.flightNumber || flight.icao24,
            timestamp: Math.floor(Date.now() / 1000),
          },
          ...prev
        ];
      }
      try {
        window.localStorage.setItem('savedPlanes', JSON.stringify(updated));
      } catch (err) {
        console.error('Failed to save planes to localStorage', err);
      }
      return updated;
    });
  };

  // Set of tracked icao24 hex codes for quick O(1) lookup
  const trackedIcaoSet = new Set(savedPlanes.map(p => p.icao24.toLowerCase()));

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
          const now = Date.now();
          setFlights(prevFlights => {
            const flightMap = new Map();
            // Retain recent flights from previous poll (grace period: 35 seconds)
            prevFlights.forEach(p => {
              if (now - (p._lastSeen || now) < 35000) {
                flightMap.set(p.id, p);
              }
            });
            // Update with fresh flight data
            data.forEach(f => {
              flightMap.set(f.id, { ...f, _lastSeen: now });
            });
            return Array.from(flightMap.values());
          });

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

        {/* Right Side: Saved / Tracked Planes */}
        <div style={{ pointerEvents: 'auto' }}>
          <button 
            onClick={() => setShowSaved(true)} 
            style={{ padding: '6px 12px', background: savedPlanes.length > 0 ? '#b45309' : '#1e3a5f', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, boxShadow: '0 4px 12px rgba(0,0,0,0.2)', fontSize: '12px', whiteSpace: 'nowrap' }}
            aria-label="View saved planes"
          >
            ★ Tracked ({savedPlanes.length})
          </button>
        </div>
      </div>

      <SavedPlanesModal 
        isOpen={showSaved} 
        onClose={() => setShowSaved(false)} 
        onRemove={(icao) => {
          setSavedPlanes(prev => {
            const updated = prev.filter(p => p.icao24.toLowerCase() !== icao.toLowerCase());
            try { window.localStorage.setItem('savedPlanes', JSON.stringify(updated)); } catch (e) {}
            return updated;
          });
        }}
      />
      
      {/* Live Flight Path Trails for ALL Tracked Planes simultaneously */}
      {savedPlanes.map(p => {
        const path = historyTracks[p.icao24.toLowerCase()] || historyTracks[p.icao24.toUpperCase()] || [];
        if (path.length < 2) return null;
        const isSelected = selectedFlight?.icao24?.toLowerCase() === p.icao24?.toLowerCase();
        return (
          <Polyline 
            key={p.icao24} 
            positions={path} 
            color={isSelected ? '#2563eb' : '#f59e0b'} 
            weight={isSelected ? 5 : 3.5} 
            opacity={isSelected ? 0.9 : 0.75} 
            dashArray={isSelected ? undefined : '5, 5'}
          />
        );
      })}

      {/* Selected Aircraft Path (if not already tracked) */}
      {selectedFlight && !trackedIcaoSet.has(selectedFlight.icao24?.toLowerCase()) && selectedBreadcrumbs.length > 1 && (
        <Polyline positions={selectedBreadcrumbs} color="#2563eb" weight={4} opacity={0.85} />
      )}

      {userPos && (
        <Marker position={[userPos.lat, userPos.lng]}>
          <Popup>You are here</Popup>
        </Marker>
      )}

      {displayedFlights.map((f) => {
        const isTracked = trackedIcaoSet.has(f.icao24?.toLowerCase());
        return (
          <Marker
            key={f.id}
            position={[f.latitude, f.longitude]}
            icon={aircraftIcon(f.trueHeadingDeg, isTracked)}
            eventHandlers={{
              click: () => handlePlaneSelect(f),
            }}
          >
            <Popup>
              <div style={{ minWidth: '210px', lineHeight: '1.4' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
                  <span style={{ fontSize: '15px', fontWeight: 'bold', color: isTracked ? '#b45309' : '#1e3a5f' }}>
                    {f.flightNumber || f.icao24}
                  </span>
                  {isTracked && (
                    <span style={{ fontSize: '10px', background: '#fef3c7', color: '#b45309', padding: '1px 6px', borderRadius: '4px', fontWeight: 600 }}>
                      ★ TRACKING
                    </span>
                  )}
                </div>

                {selectedFlight?.id === f.id && flightDetail?.airline?.name && (
                  <div style={{ color: '#2563eb', fontWeight: 600, fontSize: '13px', marginBottom: '4px' }}>
                    ✈️ {flightDetail.airline.name}
                  </div>
                )}

                {/* Aircraft Model & Tail Number Details */}
                {selectedFlight?.id === f.id && flightDetail?.aircraft && (
                  <div style={{ background: '#f8fafc', padding: '6px 8px', borderRadius: '4px', margin: '4px 0', fontSize: '12px', color: '#334155' }}>
                    <div><strong>Model:</strong> {flightDetail.aircraft.manufacturer} {flightDetail.aircraft.type || flightDetail.aircraft.icaoType}</div>
                    {flightDetail.aircraft.registration && <div><strong>Tail:</strong> {flightDetail.aircraft.registration}</div>}
                  </div>
                )}

                <div style={{ fontSize: '12px', color: '#334155', marginTop: '4px' }}>
                  <div><strong>Alt:</strong> {typeof f.altitudeFeet === 'number' ? Math.round(f.altitudeFeet).toLocaleString() : 'N/A'} ft</div>
                  <div><strong>Speed:</strong> {typeof f.groundSpeedKts === 'number' ? Math.round(f.groundSpeedKts) : 'N/A'} kt</div>
                  <div><strong>Heading:</strong> {Math.round(f.trueHeadingDeg || 0)}°</div>
                  {f.isMilitary && <div style={{ color: '#dc2626', fontWeight: 'bold', marginTop: '2px' }}>🎖️ Military Aircraft</div>}
                </div>

                <div style={{ marginTop: '8px', display: 'flex', gap: '6px' }}>
                  <button
                    style={{
                      padding: '5px 10px',
                      background: isTracked ? '#ef4444' : '#f59e0b',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '12px',
                      fontWeight: 600,
                      boxShadow: '0 2px 4px rgba(0,0,0,0.15)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleTrackPlane(f);
                    }}
                  >
                    {isTracked ? '✕ Stop Tracking' : '★ Track Plane'}
                  </button>
                </div>
              </div>
            </Popup>
          </Marker>
        );
      })}
    </MapContainer>
  );
}
