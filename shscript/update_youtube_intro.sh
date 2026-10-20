#!/bin/bash

# Database file path
DB_FILE="/app/data/songs.db"

# Check if database exists
if [[ ! -f "$DB_FILE" ]]; then
    echo "❌ Database file does not exist: $DB_FILE"
    exit 1
fi

echo "🔍 Updating youtube_song_introduction field..."

# Update the field using sqlite3
sqlite3 "$DB_FILE" << EOF
UPDATE my_song 
SET youtube_song_introduction = REPLACE(youtube_song_introduction, 'SunoAI', 'YOUR_CHANNEL_NAME')
WHERE youtube_song_introduction LIKE '%SunoAI%';
SELECT changes() as 'Number of rows updated';
EOF

if [ $? -eq 0 ]; then
    echo "✅ Update completed successfully"
else
    echo "❌ Failed to update database"
    exit 1
fi

echo "�� Process completed" 