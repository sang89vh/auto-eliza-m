#!/bin/bash

# Set the source directory
SOURCE_DIR="$HOME/suno/outputprocessed"
OUTPUT_DIR="$HOME/suno/outputprocessed"

# Create output directory if it doesn't exist
mkdir -p "$OUTPUT_DIR"

# Get current date in yyyyMMdd format
CURRENT_DATE=$(date +%Y%m%d)
OUTPUT_FILE="$OUTPUT_DIR/merged_${CURRENT_DATE}.mp4"

# Create a temporary directory for the file list
TEMP_DIR=$(mktemp -d)
INPUTS_FILE="$TEMP_DIR/inputs.txt"

# Check if source directory exists
if [[ ! -d "$SOURCE_DIR" ]]; then
    echo "❌ Source directory does not exist: $SOURCE_DIR"
    exit 1
fi

# List all MP4 files
echo "🔍 Searching for MP4 files in: $SOURCE_DIR"
> "$INPUTS_FILE"
MP4_COUNT=0

for f in "$SOURCE_DIR"/*.mp4; do
    if [[ -f "$f" ]]; then
        echo "file '$f'" >> "$INPUTS_FILE"
        echo "📝 Found MP4 file: $f"
        ((MP4_COUNT++))
    fi
done

if [[ $MP4_COUNT -eq 0 ]]; then
    echo "❌ No MP4 files found in $SOURCE_DIR"
    rm -rf "$TEMP_DIR"
    exit 1
fi

echo "✅ Found $MP4_COUNT MP4 files"

# Merge all videos
echo "🎬 Merging videos..."
ffmpeg -f concat -safe 0 -i "$INPUTS_FILE" -c:v h264_videotoolbox -preset slow -c:a aac -b:a 320k -ar 48000 -pix_fmt yuv420p -movflags +faststart -q:v 23 -vsync 2 -async 1 -max_muxing_queue_size 1024 -y "$OUTPUT_FILE"

if [[ -f "$OUTPUT_FILE" ]]; then
    echo "✅ Successfully merged videos to: $OUTPUT_FILE"
else
    echo "❌ Failed to merge videos"
fi

# Clean up temporary files
echo "🧹 Cleaning up temporary files..."
rm -rf "$TEMP_DIR"

echo "✅ Process completed" 

# Remove all files in the source directory except the output file (only if output file exists)
if [[ -f "$OUTPUT_FILE" ]]; then
    echo "🗑️ Removing all files in the source directory except the output file..."
    find "$SOURCE_DIR" -type f -name "*.mp4" ! -path "$OUTPUT_FILE" -delete
    echo "✅ Cleanup completed - kept only: $OUTPUT_FILE"
else
    echo "⚠️ Output file does not exist, skipping cleanup to preserve source files"
fi