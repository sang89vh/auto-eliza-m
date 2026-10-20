const sqlite3 = require('sqlite3').verbose();

// Create database connection
const db = new sqlite3.Database('./data/songs_win.db', (err) => {
  if (err) {
    console.error('Error opening database:', err);
    return;
  }
  console.log('Connected to SQLite database');
});

// Find and remove duplicates
db.serialize(() => {
  // First, identify duplicates
  db.all(`
    WITH DuplicateTitles AS (
      SELECT original_title, COUNT(*) as count 
      FROM my_song 
      GROUP BY original_title 
      HAVING count > 1
    )
    SELECT ms.* 
    FROM my_song ms
    INNER JOIN DuplicateTitles dt ON ms.original_title = dt.original_title
    ORDER BY ms.original_title, ms.id
  `, [], (err, rows) => {
    if (err) {
      console.error('Error checking for duplicates:', err);
      return;
    }

    if (rows.length === 0) {
      console.log('No duplicates found!');
      db.close();
      return;
    }

    console.log(`Found ${rows.length} rows with duplicate original_titles`);

    // Group duplicates by original_title
    const duplicateGroups = {};
    rows.forEach(row => {
      if (!duplicateGroups[row.original_title]) {
        duplicateGroups[row.original_title] = [];
      }
      duplicateGroups[row.original_title].push(row.id);
    });

    // For each group of duplicates, keep the first one and delete the rest
    Object.entries(duplicateGroups).forEach(([title, ids]) => {
      const keepId = ids[0];
      const deleteIds = ids.slice(1);
      
      console.log(`\nFor title "${title}":`);
      console.log(`- Keeping ID: ${keepId}`);
      console.log(`- Deleting IDs: ${deleteIds.join(', ')}`);

      // Delete all but the first occurrence
      db.run(`
        DELETE FROM my_song 
        WHERE original_title = ? AND id IN (${deleteIds.join(',')})
      `, [title], function(err) {
        if (err) {
          console.error(`Error deleting duplicates for "${title}":`, err);
        } else {
          console.log(`Successfully deleted ${this.changes} duplicate(s) for "${title}"`);
        }
      });
    });

    // Close the database connection after all operations are complete
    setTimeout(() => {
      db.close((err) => {
        if (err) {
          console.error('Error closing database:', err);
        } else {
          console.log('\nDatabase connection closed');
        }
      });
    }, 1000);
  });
}); 