import React, { useState, useEffect } from 'react';
import './App.css';

function App() {
  const [currentSong, setCurrentSong] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [copyTitleSuccess, setCopyTitleSuccess] = useState('');
  const [copyStyleSuccess, setCopyStyleSuccess] = useState('');
  const [copyLyricsSuccess, setCopyLyricsSuccess] = useState('');
  const [copyIntroSuccess, setCopyIntroSuccess] = useState('');
  const [videoCreationStatus, setVideoCreationStatus] = useState('');
  const [songCounts, setSongCounts] = useState(null);
  const [isCreateVideoDisabled, setIsCreateVideoDisabled] = useState(false);

  const fetchCurrentSong = async () => {
    try {
      const response = await fetch('http://localhost:3001/api/current-song');
      const data = await response.json();
      setCurrentSong(data);
      setLoading(false);
    } catch (err) {
      setError('Error fetching song data');
      setLoading(false);
    }
  };

  const handleNext = async () => {
    if (!currentSong) return;
    
    try {
      await fetch(`http://localhost:3001/api/update-status/${currentSong.id}`, {
        method: 'POST',
      });
      fetchCurrentSong();
    } catch (err) {
      setError('Error updating song status');
    }
  };

  const handleCopyTitle = async () => {
    if (!currentSong) return;
    
    try {
      await navigator.clipboard.writeText("Mashup - " + currentSong.title);
      setCopyTitleSuccess('Title copied!');
      setTimeout(() => setCopyTitleSuccess(''), 2000);
    } catch (err) {
      setError('Failed to copy title');
    }
  };

  const handleCopyLyrics = async () => {
    if (!currentSong) return;
    
    try {
      await navigator.clipboard.writeText(currentSong.lyrics);
      setCopyLyricsSuccess('Lyrics copied!');
      setTimeout(() => setCopyLyricsSuccess(''), 2000);
    } catch (err) {
      setError('Failed to copy lyrics');
    }
  };

  const handleCopyStyle = async () => {
    if (!currentSong) return;
    
    try {
      await navigator.clipboard.writeText(currentSong.style);
      setCopyStyleSuccess('Style copied!');
      setTimeout(() => setCopyStyleSuccess(''), 2000);
    } catch (err) {
      setError('Failed to copy style');
    }
  };

  const handleCopyIntro = async () => {
    if (!currentSong) return;
    
    try {
      await navigator.clipboard.writeText(currentSong.youtube_song_introduction);
      setCopyIntroSuccess('Introduction copied!');
      setTimeout(() => setCopyIntroSuccess(''), 2000);
    } catch (err) {
      setError('Failed to copy introduction');
    }
  };

  const handleCreateVideo = async () => {
    try {
      setIsCreateVideoDisabled(true);
      setVideoCreationStatus('Creating video...');
      const response = await fetch('http://localhost:3001/api/v2/make-video', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          "title": currentSong.title,
          "lyrics": currentSong.youtube_song_introduction.substring(0, Math.min(240, currentSong.youtube_song_introduction.length)) + "...",
          "style": currentSong.style
        })
      });
      const data = await response.json();
      if (response.ok) {
        setVideoCreationStatus('Video created successfully!');
      } else {
        setVideoCreationStatus('Error: ' + data.error);
      }
      setTimeout(() => setVideoCreationStatus(''), 3000);
      setTimeout(() => setIsCreateVideoDisabled(false), 10000);
    } catch (err) {
      setVideoCreationStatus('Error creating video');
      setTimeout(() => setVideoCreationStatus(''), 3000);
      setTimeout(() => setIsCreateVideoDisabled(false), 10000);
    }
  };

  const fetchSongCounts = async () => {
    try {
      const response = await fetch('http://localhost:3001/api/song-counts');
      const data = await response.json();
      setSongCounts(data);
    } catch (err) {
      console.error('Error fetching song counts:', err);
    }
  };

  useEffect(() => {
    fetchCurrentSong();
    fetchSongCounts();
  }, []);

  if (loading) return <div className="loading">Loading...</div>;
  if (error) return <div className="error">{error}</div>;
  if (!currentSong || currentSong.message) return <div className="no-songs">No songs available</div>;

  return (
    <div className="App">
      <div className="song-container">
        <div className="next-button-container">
          <button onClick={handleNext} className="next-button">
            Next Song
          </button>
          <button 
            onClick={handleCreateVideo} 
            className="create-video-button"
            disabled={isCreateVideoDisabled}
          >
            Create Video
          </button>
          {videoCreationStatus && (
            <span className="video-status">{videoCreationStatus}</span>
          )}
        </div>
        <div className="title-section">
          <h2>{currentSong.title}</h2>
          <button onClick={handleCopyTitle} className="copy-button">
            Copy Title
          </button>
          {copyTitleSuccess && <span className="copy-success">{copyTitleSuccess}</span>}
        </div>
        <p className="original-title">Original Title: {currentSong.original_title}</p>
        <div className="style-section">
          <p className="style">Style: {currentSong.style}</p>
          <button onClick={handleCopyStyle} className="copy-button style-copy">
            Copy Style
          </button>
          {copyStyleSuccess && <span className="copy-success style-copy-success">{copyStyleSuccess}</span>}
        </div>
        <div className="intro-section">
          <div className="intro-header">
            <h3>YouTube Introduction</h3>
            <button onClick={handleCopyIntro} className="copy-button">
              Copy Introduction
            </button>
            {copyIntroSuccess && <span className="copy-success">{copyIntroSuccess}</span>}
          </div>
          <div className="intro-content">
            {currentSong.youtube_song_introduction || 'No introduction available'}
          </div>
        </div>
        <div className="lyrics">
          <div className="lyrics-header">
            <h3>Lyrics</h3>
            <button onClick={handleCopyLyrics} className="copy-button">
              Copy Lyrics
            </button>
            {copyLyricsSuccess && <span className="copy-success">{copyLyricsSuccess}</span>}
          </div>
          <pre>{currentSong.lyrics}</pre>
        </div>
        <div className="status-counts">
          {songCounts && (
            <div className="counts-container">
              <h3>Song Status</h3>
              <div className="counts-grid">
                <div className="count-item">
                  <span className="count-label">Total:</span>
                  <span className="count-value">{songCounts.total}</span>
                </div>
                {Object.entries(songCounts.by_status).map(([status, count]) => (
                  <div key={status} className="count-item">
                    <span className="count-label">{status}:</span>
                    <span className="count-value">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App; 