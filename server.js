const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { glob } = require('glob');

const app = express();
const port = 3001;

// Remove global variables and add functions to manage indices
async function getVideoIndices() {
  return new Promise((resolve, reject) => {
    db.get('SELECT lastLongVideoIndex, lastShortVideoIndex FROM myconfig WHERE id = 1', (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

async function updateVideoIndices(longIndex, shortIndex) {
  return new Promise((resolve, reject) => {
    db.run(
      'UPDATE myconfig SET lastLongVideoIndex = ?, lastShortVideoIndex = ? WHERE id = 1',
      [longIndex, shortIndex],
      function(err) {
        if (err) reject(err);
        else resolve();
      }
    );
  });
}

// Function to count seed_long_*.wav files dynamically
function countLongVideos() {
  try {
    const seedDir = 'E:\\suno\\seed';
    if (!fs.existsSync(seedDir)) {
      console.warn(`[WARN] Seed directory not found: ${seedDir}`);
      return 34; // fallback to current value
    }
    
    const files = fs.readdirSync(seedDir);
    const longVideoFiles = files.filter(file => 
      file.toLowerCase().startsWith('seed_long_') && 
      file.toLowerCase().endsWith('.mp4')
    );
    
    console.log(`[INFO] Found ${longVideoFiles.length} long video files in ${seedDir}`);
    return longVideoFiles.length;
  } catch (error) {
    console.error('[ERROR] Failed to count long video files:', error);
    return 34; // fallback to current value
  }
}

// Function to count seed_short_*.wav files dynamically
function countShortVideos() {
  try {
    const seedDir = 'E:\\suno\\seed';
    if (!fs.existsSync(seedDir)) {
      console.warn(`[WARN] Seed directory not found: ${seedDir}`);
      return 30; // fallback to current value
    }
    
    const files = fs.readdirSync(seedDir);
    const shortVideoFiles = files.filter(file => 
      file.toLowerCase().startsWith('seed_short_') && 
      file.toLowerCase().endsWith('.mp4')
    );
    
    console.log(`[INFO] Found ${shortVideoFiles.length} short video files in ${seedDir}`);
    return shortVideoFiles.length;
  } catch (error) {
    console.error('[ERROR] Failed to count short video files:', error);
    return 30; // fallback to current value
  }
}

// Dynamic video counts
let TOTAL_LONG_VIDEOS = countLongVideos();
let TOTAL_SHORT_VIDEOS = countShortVideos();

// Add logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.url}`);
  next();
});

// Add response logging
app.use((req, res, next) => {
  const originalSend = res.send;
  res.send = function(data) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] Response ${res.statusCode} for ${req.method} ${req.url}`);
    return originalSend.apply(res, arguments);
  };
  next();
});

app.use(cors());
app.use(express.json());

const db_path = process.env.DATA_BASE_PATH || './data/songs_win.db';
console.log('[INFO] Fetching song db  ' + db_path);
// Create database connection
const db = new sqlite3.Database(db_path, (err) => {
  if (err) {
    console.error('[ERROR] Database connection failed:', err);
  } else {
    console.log('[INFO] Connected to SQLite database');
  }
});

// Get current song
app.get('/api/current-song', (req, res) => {
  console.log('[INFO] Fetching current song');
  db.get(
    'SELECT * FROM my_song WHERE status = 1 ORDER BY created_date DESC LIMIT 1',
    (err, row) => {
      if (err) {
        console.error('[ERROR] Failed to fetch current song:', err);
        res.status(500).json({ error: err.message });
        return;
      }
      console.log('[INFO] Current song fetched successfully');
      res.json(row || { message: 'No songs available' });
    }
  );
});

// Get first pending song (status = 0)
app.get('/api/pending-song', (req, res) => {
  console.log('[INFO] Fetching pending songs');
  db.all(
    'SELECT * FROM my_song WHERE status = 0 ORDER BY created_date ASC LIMIT 10',
    (err, rows) => {
      if (err) {
        console.error('[ERROR] Failed to fetch pending songs:', err);
        res.status(500).json({ error: err.message });
        return;
      }
      console.log(`[INFO] Fetched ${rows.length} pending songs`);
      res.json(rows || []);
    }
  );
});

// Update song status
app.post('/api/update-status/:id', (req, res) => {
  const { id } = req.params;
  console.log(`[INFO] Updating status for song ID: ${id}`);
  db.run(
    'UPDATE my_song SET status = 2 WHERE id = ?',
    [id],
    function(err) {
      if (err) {
        console.error(`[ERROR] Failed to update status for song ID ${id}:`, err);
        res.status(500).json({ error: err.message });
        return;
      }
      console.log(`[INFO] Successfully updated status for song ID: ${id}`);
      res.json({ message: 'Status updated successfully' });
    }
  );
});

// Update song status to 0 by ID
app.post('/api/reset-status/:id', (req, res) => {
  const { id } = req.params;
  console.log(`[INFO] Resetting status for song ID: ${id}`);
  db.run(
    'UPDATE my_song SET status = 0 WHERE id = ?',
    [id],
    function(err) {
      if (err) {
        console.error(`[ERROR] Failed to reset status for song ID ${id}:`, err);
        res.status(500).json({ error: err.message });
        return;
      }
      if (this.changes === 0) {
        console.log(`[WARN] Song ID ${id} not found for reset`);
        return res.status(404).json({ error: 'Song not found' });
      }
      console.log(`[INFO] Successfully reset status for song ID: ${id}`);
      res.json({ message: 'Status reset to 0 successfully' });
    }
  );
});

// Update song status to error (status = 3)
app.post('/api/update-status-error/:id', (req, res) => {
  const { id } = req.params;
  console.log(`[INFO] Setting error status for song ID: ${id}`);
  db.run(
    'UPDATE my_song SET status = 3 WHERE id = ?',
    [id],
    function(err) {
      if (err) {
        console.error(`[ERROR] Failed to set error status for song ID ${id}:`, err);
        res.status(500).json({ error: err.message });
        return;
      }
      if (this.changes === 0) {
        console.log(`[WARN] Song ID ${id} not found for error status update`);
        return res.status(404).json({ error: 'Song not found' });
      }
      console.log(`[INFO] Successfully set error status for song ID: ${id}`);
      res.json({ message: 'Status updated to error successfully' });
    }
  );
});

// Insert new song
app.post('/api/songs', (req, res) => {
  const { title, lyrics, original_title, styles, youtube_song_introduction } = req.body;

  // Validate required fields
  if (!title || !lyrics || !original_title || !styles) {
    return res.status(400).json({ 
      error: 'Missing required fields. Please provide title, lyrics, original_title, and styles' 
    });
  }

  // Check for existing song with same original_title and status = 0
  db.get('SELECT id FROM my_song WHERE original_title = ? AND status = 0', [original_title], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    if (row) {
      // Update existing song with status = 0
      const updateSql = `
        UPDATE my_song 
        SET title = ?,
            lyrics = ?,
            style = ?,
            youtube_song_introduction = ?,
            status = 1,
            created_date = CURRENT_TIMESTAMP
        WHERE id = ?
      `;

      db.run(updateSql, [title, lyrics, styles, youtube_song_introduction, row.id], function(err) {
        if (err) {
          res.status(500).json({ error: err.message });
          return;
        }
        res.status(200).json({
          message: 'Song updated successfully',
          songId: row.id
        });
      });
    } else {
      // Check if song exists with status != 0
      db.get('SELECT id FROM my_song WHERE original_title = ? AND status != 0', [original_title], (err, existingRow) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }

        if (existingRow) {
          return res.status(400).json({ 
            error: 'A song with this original title already exists with status != 0',
            duplicateId: existingRow.id
          });
        }

        // Insert new song
        const insertSql = `
          INSERT INTO my_song (
            title,
            lyrics,
            original_title,
            style,
            youtube_song_introduction,
            status,
            created_date
          ) VALUES (?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
        `;

        db.run(insertSql, [title, lyrics, original_title, styles, youtube_song_introduction], function(err) {
          if (err) {
            res.status(500).json({ error: err.message });
            return;
          }
          res.status(201).json({
            message: 'Song added successfully',
            songId: this.lastID
          });
        });
      });
    }
  });
});

// Initialize songs with original titles
app.post('/api/init-songs', (req, res) => {
  const { original_titles } = req.body;

  // Validate input
  if (!Array.isArray(original_titles) || original_titles.length === 0) {
    return res.status(400).json({ 
      error: 'Please provide an array of original titles' 
    });
  }

  // First check which songs already exist
  const checkSql = 'SELECT original_title, status FROM my_song WHERE original_title = ?';
  const insertSql = `
    INSERT INTO my_song (
      original_title,
      status,
      created_date
    ) VALUES (?, 0, CURRENT_TIMESTAMP)
  `;

  const results = {
    inserted: [],
    existing: [],
    errors: []
  };

  // Process each title
  const processTitle = (title) => {
    return new Promise((resolve) => {
      // First check if song exists
      db.get(checkSql, [title], (err, row) => {
        if (err) {
          results.errors.push({ title, error: err.message });
          resolve();
        } else if (row) {
          // Song already exists, keep its current status
          results.existing.push({ title, status: row.status });
          resolve();
        } else {
          // Song doesn't exist, insert it with status 0
          db.run(insertSql, [title], function(err) {
            if (err) {
              results.errors.push({ title, error: err.message });
            } else {
              results.inserted.push({ title, id: this.lastID, status: 0 });
            }
            resolve();
          });
        }
      });
    });
  };

  // Process all titles and send response
  Promise.all(original_titles.map(processTitle))
    .then(() => {
      const response = {
        message: 'Songs processed successfully',
        inserted: results.inserted.length,
        existing: results.existing.length,
        errors: results.errors.length,
        details: results
      };

      // Return 201 if any songs were inserted successfully
      if (results.inserted.length > 0) {
        res.status(201).json(response);
      } else if (results.errors.length === 0) {
        // If no errors but no insertions (all existed), return 200
        res.status(200).json(response);
      } else {
        // If there were only errors, return 500
        res.status(500).json(response);
      }
    });
});

// Reset all error songs (status = 3) back to pending (status = 0)
app.post('/api/reset-all-status', (req, res) => {
  console.log('[INFO] Resetting all error songs to pending status');
  db.run(
    'UPDATE my_song SET status = 0 WHERE status = 3',
    function(err) {
      if (err) {
        console.error('[ERROR] Failed to reset all error songs:', err);
        res.status(500).json({ error: err.message });
        return;
      }
      console.log(`[INFO] Successfully reset ${this.changes} error songs to pending status`);
      res.json({ 
        message: 'All error songs reset to pending successfully',
        updatedCount: this.changes 
      });
    }
  );
});

// Create video from WAV files
app.post('/api/create-video', async (req, res) => {
  console.log('[INFO] Creating video from WAV files');
  
  try {
    const { exec } = require('child_process');
    const scriptPath = process.env.SCRIPT_PATH || './shscript/merge_audio_video.sh';
    
    // Get current indices from database
    const indices = await getVideoIndices();
    
    // Calculate new indices
    const longVideoIndex = (indices.lastLongVideoIndex + 1) % TOTAL_LONG_VIDEOS;
    const shortVideoIndex = (indices.lastShortVideoIndex + 1) % TOTAL_SHORT_VIDEOS;
    
    // Update indices in database
    await updateVideoIndices(longVideoIndex, shortVideoIndex);
    
    console.log(`[INFO] Selected long video index: ${longVideoIndex} (round-robin)`);
    console.log(`[INFO] Selected short video index: ${shortVideoIndex} (round-robin)`);
    
    exec(`${scriptPath} ${longVideoIndex} ${shortVideoIndex}`, (error, stdout, stderr) => {
      if (error) {
        console.error(`[ERROR] Failed to create video: ${error}`);
        return res.status(500).json({ error: error.message });
      }
      if (stderr) {
        console.error(`[ERROR] Script stderr: ${stderr}`);
      }
      console.log(`[INFO] Video creation output: ${stdout}`);
      res.json({ message: 'Video created successfully' });
    });
  } catch (error) {
    console.error('[ERROR] Failed to process video indices:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get song counts by status
app.get('/api/song-counts', (req, res) => {
  console.log('[INFO] Fetching song counts by status');
  
  const query = `
    SELECT 
      status,
      COUNT(*) as count,
      CASE 
        WHEN status = 0 THEN 'Pending'
        WHEN status = 1 THEN 'Current'
        WHEN status = 2 THEN 'Processed'
        WHEN status = 3 THEN 'Error'
        ELSE 'Unknown'
      END as status_name
    FROM my_song 
    GROUP BY status
    ORDER BY status
  `;

  db.all(query, [], (err, rows) => {
    if (err) {
      console.error('[ERROR] Failed to fetch song counts:', err);
      res.status(500).json({ error: err.message });
      return;
    }

    // Create a more structured response
    const counts = {
      total: 0,
      by_status: {}
    };

    rows.forEach(row => {
      counts.by_status[row.status_name] = row.count;
      counts.total += row.count;
    });

    console.log('[INFO] Successfully fetched song counts');
    res.json(counts);
  });
});
app.post('/api/v2/make-video', async (req, res) => {
  console.log('[INFO] Headers:', req.headers);
  console.log('[INFO] Raw data:', req.body);
  
  try {
    // Get current indices from database
    const indices = await getVideoIndices();
    // Calculate new indices
    const longVideoIndex = (indices.lastLongVideoIndex + 1) % TOTAL_LONG_VIDEOS;
    const shortVideoIndex = (indices.lastShortVideoIndex + 1) % TOTAL_SHORT_VIDEOS;
    
    // Update indices in database
    await updateVideoIndices(longVideoIndex, shortVideoIndex);
    
    console.log(`[INFO] Selected long video index: ${longVideoIndex} (round-robin)`);
    console.log(`[INFO] Selected short video index: ${shortVideoIndex} (round-robin)`);

    try {
      const response = await fetch('http://localhost:5001/api/v2/make-video', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          lyrics: req.body.lyrics,
          title: req.body.title,
          style: req.body.style,
          long_video_index: longVideoIndex,
          short_video_index: shortVideoIndex
        })
      });

      if (response.ok) {
        console.log('[INFO] Successfully called create-video API:', await response.json());
      } else {
        console.error('[ERROR] Error calling create-video API:', response.status);
      }
    } catch (error) {
      console.error('[ERROR] Failed to call create-video API:', error.message);
    }
    
    res.json({
      status: "okie"
    });
  } catch (error) {
    console.error('[ERROR] Failed to process files:', error);
    res.status(500).json({
      error: error.message
    });
  }
});
// Find and copy files endpoint
app.post('/api/find_and_copy', async (req, res) => {
  console.log('[INFO] Headers:', req.headers);
  console.log('[INFO] Raw data:', req.body);
  
  const { file_name } = req.body;
  const sourceFolder = process.env.BACKUP_WAV_DIR || path.join(os.homedir(), 'backupwav');
  const desFolder = process.env.DOWNLOAD_DIR || path.join(os.homedir(), 'suno', 'input');

  try {
    // Create destination directory if it doesn't exist
    if (!fs.existsSync(desFolder)) {
      fs.mkdirSync(desFolder, { recursive: true });
    }

    // Find all WAV files
    const wavFiles = await glob(path.join(sourceFolder, '*.wav'));

    // Filter and copy files
    const copiedFiles = [];
    for (const filePath of wavFiles) {
      const fileName = path.basename(filePath);
      if (fileName.toLowerCase().includes(file_name.toLowerCase())) {
        const destPath = path.join(desFolder, fileName);
        fs.copyFileSync(filePath, destPath);
        copiedFiles.push(fileName);
      }
    }

    // If files were copied, call create-video endpoint
    if (copiedFiles.length > 0) {
      try {
        const response = await fetch('http://localhost:3001/api/create-video', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          }
        });

        if (response.ok) {
          console.log('[INFO] Successfully called create-video API:', await response.json());
        } else {
          console.error('[ERROR] Error calling create-video API:', response.status);
        }
      } catch (error) {
        console.error('[ERROR] Failed to call create-video API:', error.message);
      }
    }

    res.json({
      copied_files: copiedFiles,
      count: copiedFiles.length
    });
  } catch (error) {
    console.error('[ERROR] Failed to process files:', error);
    res.status(500).json({
      error: error.message
    });
  }
});

app.listen(port, () => {
  console.log(`[INFO] Server running at http://localhost:${port}`);
}); 