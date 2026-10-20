const sqlite3 = require('sqlite3').verbose();

// Database file: the first CLI argument, else the Docker volume path.
// Example: node setup-db.js ./data/songs_win.db
const dbPath = process.argv[2] || '/app/data/songs.db';

// Create database connection
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err);
    return;
  }
  console.log('Connected to SQLite database');
});

// Create table and insert sample data
db.serialize(() => {
  // Drop table if exists
  db.run('DROP TABLE IF EXISTS my_song');

  // Create table
  db.run(`CREATE TABLE my_song (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    original_title TEXT NOT NULL,
    title TEXT,
    lyrics TEXT,
    style TEXT,
    youtube_song_introduction TEXT,
    status INTEGER DEFAULT 1,
    created_date DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Insert sample data
  const sampleSongs = [
    {
      original_title: "Yesterday",
      title: "Yesterday",
      lyrics: "[Verse]\nSample lyrics, replace with your own",
      style: "Pop",
      status: 1
    },
    {
      original_title: "Bohemian Rhapsody",
      title: "Bohemian Rhapsody",
      lyrics: "[Verse]\nSample lyrics, replace with your own",
      style: "Rock",
      status: 1
    },
    {
      original_title: "Billie Jean",
      title: "Billie Jean",
      lyrics: "[Verse]\nSample lyrics, replace with your own",
      style: "Pop",
      status: 1
    },
    {
      original_title: "Sweet Child O' Mine",
      title: "Sweet Child O' Mine",
      lyrics: "[Verse]\nSample lyrics, replace with your own",
      style: "Rock",
      status: 1
    },
    {
      original_title: "Purple Rain",
      title: "Purple Rain",
      lyrics: "[Verse]\nSample lyrics, replace with your own",
      style: "Pop Rock",
      status: 1
    }
  ];

  const insert = db.prepare('INSERT INTO my_song (original_title, title, lyrics, style, status) VALUES (?, ?, ?, ?, ?)');
  
  sampleSongs.forEach(song => {
    insert.run(
      song.original_title,
      song.title,
      song.lyrics,
      song.style,
      song.status
    );
  });

  insert.finalize();

  console.log('Sample data inserted successfully');
});

// Close the database connection
db.close((err) => {
  if (err) {
    console.error('Error closing database:', err);
  } else {
    console.log('Database connection closed');
  }
}); 