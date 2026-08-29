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

  const fetchDetail = async (plane) => {
    try {
      const res = await fetch(
        `/api/flightDetail?icao24=${plane.icao24}&timestamp=${plane.timestamp}`,
      );
      const data = await res.json();
      setDetail({ plane, data });
    } catch (e) {
      console.error('Error fetching flight detail', e);
    }
  };

  if (!isOpen) return null;

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h2>Saved Planes</h2>
        <button style={styles.closeBtn} onClick={onClose}>✖</button>
        <ul style={styles.list}>
          {saved.map((p, idx) => (
            <li key={idx} style={styles.listItem}>
              <span>{new Date(p.timestamp).toLocaleString()} – {p.flightNumber || p.icao24}</span>
              <button style={styles.detailBtn} onClick={() => fetchDetail(p)}>
                Details
              </button>
            </li>
          ))}
        </ul>
        {detail && (
          <div style={styles.detailBox}>
            <h3>Flight Detail</h3>
            <pre style={styles.pre}>{JSON.stringify(detail.data, null, 2)}</pre>
            <button onClick={() => setDetail(null)}>Close</button>
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
