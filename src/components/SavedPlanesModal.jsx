// src/components/SavedPlanesModal.jsx
import { useState, useEffect } from 'react';

/**
 * Modal that shows a list of saved planes (from localStorage) sorted by most recent.
 * Clicking a plane fetches detailed flight info via /api/flightDetail and displays it.
 */
export default function SavedPlanesModal({ isOpen, onClose }) {
  const [saved, setSaved] = useState([]); // array of saved plane objects
  const [detail, setDetail] = useState(null); // detailed info for selected plane

  // Load saved planes from localStorage when modal opens
  useEffect(() => {
    if (!isOpen) return;
    const raw = window.localStorage.getItem('savedPlanes');
    let arr = [];
    if (raw) {
      try {
        arr = JSON.parse(raw);
      } catch (e) {
        console.error('Failed to parse savedPlanes', e);
      }
    }
    // sort by timestamp descending
    arr.sort((a, b) => b.timestamp - a.timestamp);
    setSaved(arr);
    setDetail(null);
  }, [isOpen]);

  // Close modal on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const fetchDetail = async (plane) => {
    try {
      const res = await fetch(
        `/api/flightDetail?icao24=${plane.icao24}&callsign=${encodeURIComponent(plane.flightNumber || '')}`,
      );
      const data = await res.json();
      setDetail({ plane, data });
    } catch (e) {
      console.error('Error fetching flight detail', e);
    }
  };

  if (!isOpen) return null;

  return (
    <div style={styles.overlay} onClick={onClose} role="dialog" aria-modal="true" aria-label="Saved planes list">
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h2>⭐ Saved Planes</h2>
        <button style={styles.closeBtn} onClick={onClose} aria-label="Close saved planes">✖</button>
        <ul style={styles.list}>
          {saved.length === 0 ? (
            <li style={{ padding: '1rem', textAlign: 'center', color: '#64748b' }}>No saved planes yet</li>
          ) : (
            saved.map((p, idx) => (
              <li key={idx} style={styles.listItem}>
                <div>
                  <div style={{ fontWeight: 600, color: '#1e3a5f' }}>{p.flightNumber || p.icao24}</div>
                  <div style={{ fontSize: '11px', color: '#64748b' }}>{new Date(p.timestamp * 1000).toLocaleString()}</div>
                </div>
                <button style={styles.detailBtn} onClick={() => fetchDetail(p)}>
                  Details
                </button>
              </li>
            ))
          )}
        </ul>

        {detail && (
          <div style={styles.detailBox}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <h3 style={{ margin: 0, fontSize: '15px', color: '#1e3a5f' }}>
                {detail.plane.flightNumber || detail.plane.icao24} Info
              </h3>
              <button 
                onClick={() => setDetail(null)}
                style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '14px' }}
              >
                ✕
              </button>
            </div>

            {detail.data?.airline?.name && (
              <div style={{ color: '#2563eb', fontWeight: 600, fontSize: '13px', marginBottom: '6px' }}>
                ✈️ {detail.data.airline.name}
              </div>
            )}

            {detail.data?.aircraft && (
              <div style={{ fontSize: '12px', color: '#475569', background: '#f8fafc', padding: '8px', borderRadius: '4px' }}>
                <div><strong>Model:</strong> {detail.data.aircraft.manufacturer} {detail.data.aircraft.type || detail.data.aircraft.icaoType}</div>
                {detail.data.aircraft.registration && <div><strong>Tail #:</strong> {detail.data.aircraft.registration}</div>}
                {detail.data.aircraft.registeredOwner && <div><strong>Owner:</strong> {detail.data.aircraft.registeredOwner}</div>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100vw',
    height: '100vh',
    backgroundColor: 'rgba(0,0,0,0.5)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  modal: {
    background: 'white',
    padding: '1rem',
    borderRadius: '8px',
    width: '90%',
    maxWidth: '500px',
    maxHeight: '80vh',
    overflowY: 'auto',
    position: 'relative',
  },
  closeBtn: {
    position: 'absolute',
    top: '0.5rem',
    right: '0.5rem',
    background: 'transparent',
    border: 'none',
    fontSize: '1.2rem',
    cursor: 'pointer',
  },
  list: { listStyle: 'none', padding: 0 },
  listItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '0.5rem',
    borderBottom: '1px solid #eee',
    paddingBottom: '0.3rem',
  },
  detailBtn: { marginLeft: '0.5rem' },
  detailBox: {
    marginTop: '1rem',
    background: '#f9f9f9',
    padding: '0.5rem',
    borderRadius: '4px',
  },
  pre: { whiteSpace: 'pre-wrap', wordBreak: 'break-all' },
};
