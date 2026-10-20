const sqlite3 = require('sqlite3').verbose();

// Create database connection
const db = new sqlite3.Database('/app/data/songs.db', (err) => {
  if (err) {
    console.error('Error opening database:', err);
    return;
  }
  console.log('Connected to SQLite database');
});

// Update all songs status to 1
db.run('UPDATE my_song SET status = 1', function(err) {
  if (err) {
    console.error('Error updating status:', err);
  } else {
    console.log(`Successfully updated ${this.changes} songs to status 1`);
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