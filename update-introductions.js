const sqlite3 = require('sqlite3').verbose();

// Create database connection
const db = new sqlite3.Database('/app/data/songs.db', (err) => {
  if (err) {
    console.error('Error opening database:', err);
    return;
  }
  console.log('Connected to SQLite database');
});

// Function to clean lyrics
function cleanLyrics(lyrics) {
  if (!lyrics) return '';
  return lyrics
    .replace(/\[Verse \d+\]/g, '')
    .replace(/\[Pre-Chorus\]/g, '')
    .replace(/\[Chorus\]/g, '')
    .replace(/\[Bridge\]/g, '')
    .replace(/\[Final Chorus\]/g, '')
    .replace(/\[Outro\]/g, '')
    .replace(/\n\s*\n/g, '\n')
    .trim();
}

// Function to create introduction text
function createIntroduction(lyrics) {
  const cleanedLyrics = cleanLyrics(lyrics);
  return `🎧 CHÀO MỪNG BẠN ĐẾN VỚI THẾ GIỚI MASHUP ĐỈNH CAO!
Khám phá thế giới âm nhạc mới lạ – nơi những bản hit quốc tế được làm mới hoàn toàn bằng phong cách Việt.
Mỗi mashup là một hành trình cảm xúc: kết hợp sáng tạo, phối khí độc đáo và chất âm hiện đại.

🔥 Từ nhịp EDM bốc lửa, chill thư giãn, đến giai điệu sâu lắng – tất cả hòa quyện để tạo nên trải nghiệm âm nhạc không giới hạn.
👉 Hãy đeo tai nghe, bật max volume và sẵn sàng feel the vibe cùng chúng mình!

📌 Đừng quên Like, Share & Đăng Ký kênh để không bỏ lỡ những bản mashup mới nhất!
🎶 Bạn muốn mashup bài nào tiếp theo? Comment bên dưới nhé!

🎵 Hashtags:
#MashupNhacViet #EDMMashup #NhacHot2025 #MixNhac #MashupEDM  
#NhacRemix #NhacTikTok #NhacDance #NhacChill #PlaylistHay  
#VietnamMashup #EDMRemix #MusicMashup #NhacTre #NhacSong  
#VietnameseMusic #MashupHits #DanceMusic #VietEDM #LoFiViet 
-----------------

${cleanedLyrics}`;
}

// Update all rows where youtube_song_introduction is null or empty
db.all('SELECT id, lyrics FROM my_song WHERE youtube_song_introduction IS NULL OR youtube_song_introduction = ""', [], (err, rows) => {
  if (err) {
    console.error('Error fetching songs:', err);
    return;
  }

  console.log(`Found ${rows.length} songs to update`);

  // Prepare update statement
  const updateStmt = db.prepare('UPDATE my_song SET youtube_song_introduction = ? WHERE id = ?');
  
  // Update each row
  rows.forEach(row => {
    const introduction = createIntroduction(row.lyrics);
    updateStmt.run(introduction, row.id, function(err) {
      if (err) {
        console.error(`Error updating song ID ${row.id}:`, err);
      } else {
        console.log(`Updated song ID ${row.id}`);
      }
    });
  });

  // Finalize the statement
  updateStmt.finalize();

  // Close the database connection after all updates are complete
  db.wait(() => {
    db.close((err) => {
      if (err) {
        console.error('Error closing database:', err);
      } else {
        console.log('Database connection closed');
      }
    });
  });
}); 