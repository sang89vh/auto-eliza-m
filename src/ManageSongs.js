import React, { useEffect, useState } from 'react';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001';

function ManageSongs() {
  const [songs, setSongs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editingSong, setEditingSong] = useState(null);
  const [form, setForm] = useState({
    title: '',
    original_title: '',
    lyrics: '',
    style: '',
    youtube_song_introduction: '',
    status: 1
  });
  const [showForm, setShowForm] = useState(false);
  const [isNew, setIsNew] = useState(false);

  const fetchSongs = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(
        `${API_BASE}/api/songs?page=${page}&limit=20&search=${encodeURIComponent(search)}`
      );
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setSongs(data);
    } catch (err) {
      setError('Failed to fetch songs');
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchSongs();
    // eslint-disable-next-line
  }, [page, search]);

  const handleEdit = (song) => {
    setEditingSong(song);
    setForm({ ...song });
    setShowForm(true);
    setIsNew(false);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this song?')) return;
    try {
      await fetch(`${API_BASE}/api/songs/${id}`, { method: 'DELETE' });
      fetchSongs();
    } catch {
      setError('Failed to delete song');
    }
  };

  const handleAdd = () => {
    setEditingSong(null);
    setForm({
      title: '',
      original_title: '',
      lyrics: '',
      style: '',
      youtube_song_introduction: '',
      status: 1
    });
    setShowForm(true);
    setIsNew(true);
  };

  const handleFormChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleFormSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      if (isNew) {
        // Add new
        const res = await fetch(`${API_BASE}/api/songs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...form,
            styles: form.style // backend expects 'styles' for POST
          })
        });
        if (!res.ok) throw new Error('Failed to add song');
      } else {
        // Edit
        const res = await fetch(`${API_BASE}/api/songs/${editingSong.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form)
        });
        if (!res.ok) throw new Error('Failed to update song');
      }
      setShowForm(false);
      fetchSongs();
    } catch {
      setError('Failed to save song');
    }
  };

  // --- Styling ---
  const statusOptions = [
    { value: 0, label: 'Pending' },
    { value: 1, label: 'Current' },
    { value: 2, label: 'Processed' },
    { value: 3, label: 'Error' },
  ];
  const card = {
    background: '#fff',
    borderRadius: 12,
    boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
    padding: 32,
    maxWidth: 1100,
    margin: '32px auto',
    minHeight: 600
  };
  const header = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24
  };
  const searchInput = {
    padding: '8px 14px',
    borderRadius: 6,
    border: '1px solid #d0d7de',
    fontSize: 16,
    marginRight: 12
  };
  const addBtn = {
    background: 'linear-gradient(90deg,#007bff,#00c6ff)',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    padding: '10px 22px',
    fontWeight: 600,
    fontSize: 16,
    cursor: 'pointer',
    boxShadow: '0 2px 8px rgba(0,123,255,0.08)'
  };
  const table = {
    width: '100%',
    borderCollapse: 'collapse',
    marginTop: 12,
    fontSize: 15,
    background: '#f8fafc',
    borderRadius: 8,
    overflow: 'hidden',
    boxShadow: '0 1px 4px rgba(0,0,0,0.04)'
  };
  const th = {
    background: '#f1f3f7',
    color: '#333',
    fontWeight: 700,
    padding: '12px 8px',
    borderBottom: '2px solid #e5e7eb',
    textAlign: 'left'
  };
  const td = {
    padding: '10px 8px',
    borderBottom: '1px solid #e5e7eb',
    background: '#fff'
  };
  const zebra = idx => ({ ...td, background: idx % 2 === 0 ? '#f8fafc' : '#fff' });
  const actionBtn = {
    background: '#f5f6fa',
    color: '#007bff',
    border: '1px solid #d0d7de',
    borderRadius: 5,
    padding: '6px 14px',
    marginRight: 8,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'background 0.2s',
  };
  const delBtn = {
    ...actionBtn,
    color: '#fff',
    background: 'linear-gradient(90deg,#ff5858,#f09819)',
    border: 'none',
    marginRight: 0
  };
  const pagination = {
    marginTop: 24,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16
  };
  const modalOverlay = {
    position: 'fixed',
    top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.18)',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  };
  const modal = {
    background: '#fff',
    borderRadius: 10,
    boxShadow: '0 4px 24px rgba(0,0,0,0.18)',
    padding: 64,
    minWidth: 1200,
    maxWidth: 1560
  };
  const modalTitle = { fontSize: 22, fontWeight: 700, marginBottom: 18 };
  const modalField = { marginBottom: 14 };
  const modalInput = {
    width: '100%',
    padding: '8px 12px',
    borderRadius: 5,
    border: '1px solid #d0d7de',
    fontSize: 15
  };
  const modalTextarea = { ...modalInput, minHeight: 60 };
  const modalActions = { marginTop: 18, display: 'flex', gap: 12 };
  const saveBtn = {
    background: 'linear-gradient(90deg,#28a745,#00c851)',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    padding: '10px 22px',
    fontWeight: 600,
    fontSize: 16,
    cursor: 'pointer',
  };
  const cancelBtn = {
    background: '#f5f6fa',
    color: '#333',
    border: '1px solid #d0d7de',
    borderRadius: 6,
    padding: '10px 22px',
    fontWeight: 600,
    fontSize: 16,
    cursor: 'pointer',
  };

  return (
    <div style={card}>
      <div style={header}>
        <h2 style={{ margin: 0, fontSize: 28, fontWeight: 800, color: '#222' }}>🎵 Song Admin</h2>
        <div>
          <input
            type="text"
            placeholder="Search by title"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            style={searchInput}
          />
          <button style={addBtn} onClick={handleAdd}>+ Add New Song</button>
        </div>
      </div>
      {loading ? (
        <div style={{ textAlign: 'center', fontSize: 18, color: '#888', margin: '40px 0' }}>Loading...</div>
      ) : error ? (
        <div style={{ color: '#dc3545', textAlign: 'center', fontSize: 17, margin: '40px 0' }}>{error}</div>
      ) : (
        <div style={{ overflowX: 'auto', borderRadius: 8 }}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>ID</th>
                <th style={th}>Title</th>
                <th style={th}>Original Title</th>
                <th style={th}>Style</th>
                <th style={th}>Status</th>
                <th style={th}>Created</th>
                <th style={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {songs.map((song, idx) => (
                <tr key={song.id}>
                  <td style={zebra(idx)}>{song.id}</td>
                  <td style={zebra(idx)}>{song.title}</td>
                  <td style={zebra(idx)}>{song.original_title}</td>
                  <td style={zebra(idx)}>{song.style}</td>
                  <td style={zebra(idx)}>{
                    statusOptions.find(opt => Number(opt.value) === Number(song.status))?.label || 'Unknown'
                  }</td>
                  <td style={zebra(idx)}>{song.created_date}</td>
                  <td style={zebra(idx)}>
                    <button style={actionBtn} onClick={() => handleEdit(song)}>Edit</button>
                    <button style={delBtn} onClick={() => handleDelete(song.id)}>Delete</button>
                  </td>
                </tr>
              ))}
              {songs.length === 0 && (
                <tr><td colSpan="7" style={{ textAlign: 'center', padding: 32, color: '#888' }}>No songs found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <div style={pagination}>
        <button style={actionBtn} onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Prev</button>
        <span style={{ fontWeight: 600, fontSize: 16 }}>Page {page}</span>
        <button style={actionBtn} onClick={() => setPage(p => p + 1)} disabled={songs.length < 20}>Next</button>
      </div>
      {showForm && (
        <div style={modalOverlay}>
          <div style={modal}>
            <div style={modalTitle}>{isNew ? 'Add New Song' : 'Edit Song'}</div>
            <form onSubmit={handleFormSubmit}>
              <div style={modalField}>
                <label>Title:<br />
                  <input name="title" value={form.title} onChange={handleFormChange} required style={modalInput} />
                </label>
              </div>
              <div style={modalField}>
                <label>Original Title:<br />
                  <input name="original_title" value={form.original_title} onChange={handleFormChange} required style={modalInput} />
                </label>
              </div>
              <div style={modalField}>
                <label>Lyrics:<br />
                  <textarea name="lyrics" value={form.lyrics} onChange={handleFormChange} rows={3} style={modalTextarea} required />
                </label>
              </div>
              <div style={modalField}>
                <label>Style:<br />
                  <textarea name="style" value={form.style} onChange={handleFormChange} required style={modalTextarea} />
                </label>
              </div>
              <div style={modalField}>
                <label>YouTube Introduction:<br />
                  <textarea name="youtube_song_introduction" value={form.youtube_song_introduction} onChange={handleFormChange} style={modalTextarea} />
                </label>
              </div>
              <div style={modalField}>
                <label>Status:<br />
                  <select
                    name="status"
                    value={form.status}
                    onChange={handleFormChange}
                    style={modalInput}
                  >
                    {statusOptions.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div style={modalActions}>
                <button type="submit" style={saveBtn}>Save</button>
                <button type="button" style={cancelBtn} onClick={() => setShowForm(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default ManageSongs; 