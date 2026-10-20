#!/bin/bash

# Input video file
INPUT_VIDEO="E:\\suno\\merged\\20251210_merged.mp4"
OUTPUT_DIR="E:\\suno\\merged\\split"

# Create output directory if it doesn't exist
mkdir -p "$OUTPUT_DIR"

# Check if input video exists
if [[ ! -f "$INPUT_VIDEO" ]]; then
    echo "❌ Input video does not exist: $INPUT_VIDEO"
    exit 1
fi

# Get video duration
echo "⏱️ Getting video duration..."
DURATION=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$INPUT_VIDEO")
echo "📊 Total duration: $DURATION seconds"

# Calculate duration for each part
PART_DURATION=10800
echo "📊 Each part will be $PART_DURATION seconds"

# Split video into segments of 120 seconds each
echo "🎬 Splitting video into segments of 30 seconds each..."

# Use ffmpeg to split the video into segments
ffmpeg -y -i "$INPUT_VIDEO" -c copy -map 0 -segment_time "$PART_DURATION" -f segment -reset_timestamps 1 "$OUTPUT_DIR/seed_long_%d.mp4"

echo "🎉 All segments have been created in: $OUTPUT_DIR"
echo "📁 Files created:"
ls -1 "$OUTPUT_DIR"/seed_long_*.mp4 