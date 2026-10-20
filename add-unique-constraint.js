const sqlite3 = require('sqlite3').verbose();

// Create database connection
const db = new sqlite3.Database('./data/songs_win.db', (err) => {
  if (err) {
    console.error('Error opening database:', err);
    return;
  }
  console.log('Connected to SQLite database');
});

// Add unique constraint to original_title column
db.serialize(() => {
  // First, check for any duplicate original_titles
  db.all(`
    SELECT original_title, COUNT(*) as count 
    FROM my_song 
    GROUP BY original_title 
    HAVING count > 1
  `, [], (err, rows) => {
    if (err) {
      console.error('Error checking for duplicates:', err);
      return;
    }

    if (rows.length > 0) {
      console.log('Found duplicate original_titles:');
      rows.forEach(row => {
        console.log(`${row.original_title}: ${row.count} occurrences`);
      });
      console.log('Please remove duplicates before adding unique constraint');
      return;
    } else {
      // No duplicates found, safe to add unique constraint
      db.run(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_original_title_unique 
        ON my_song(original_title)
      `, function(err) {
        if (err) {
          console.error('Error adding unique constraint:', err);
        } else {
          console.log('Successfully added unique constraint to original_title column');
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
    }
  });
}); 