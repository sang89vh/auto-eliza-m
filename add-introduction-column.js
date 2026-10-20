const sqlite3 = require('sqlite3').verbose();

// Create database connection
const db = new sqlite3.Database('/app/data/songs.db', (err) => {
  if (err) {
    console.error('Error opening database:', err);
    return;
  }
  console.log('Connected to SQLite database');
});

// Add the new column
db.run('ALTER TABLE my_song ADD COLUMN youtube_song_introduction TEXT', function(err) {
  if (err) {
    console.error('Error adding column:', err);
  } else {
    console.log('Successfully added youtube_song_introduction column');
  }
  
  // Close the database connection
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err);
    } else {
      console.log('Database connection closed');
    }
  });
}); 