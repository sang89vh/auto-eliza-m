#!/bin/bash

# Usage:
# ./merge_audio_video.sh <long_video_index> <short_video_index>
# Example: ./merge_audio_video.sh 3 1

set -e

# Record start time
START_TIME=$(date)
echo "🚀 Script started at: $START_TIME"
echo "=================================="

# Get random indices from command line arguments
if [[ $# -ne 2 ]]; then
  echo "❌ Please provide both long and short video indices"
  echo "Usage: ./merge_audio_video.sh <long_video_index> <short_video_index>"
  exit 1
fi

RANDOM_INDEX=$1
RANDOM_INDEX_SHORT=$2

if [[ $RANDOM_INDEX -eq 0 || $RANDOM_INDEX -gt 100 ]]; then
  RANDOM_INDEX=1
fi
if [[ $RANDOM_INDEX_SHORT -eq 0 || $RANDOM_INDEX_SHORT -gt 100 ]]; then
  RANDOM_INDEX_SHORT=1
fi

# Arguments
INPUT_DIR="$HOME/suno/input"
SEED_DIR="$HOME/suno/seed/"
OUTPUT_VIDEO="$HOME/suno/output/output.mp4"
OUTPUT_VIDEO_FOLDER="$HOME/suno/output"
OUTPUT_VIDEO_SHORT="$HOME/suno/output/output_short.mp4"

# List of available seed videos
SEED_VIDEOS=(
  "seed_long_1.mp4"
  "seed_long_2.mp4"
  "seed_long_3.mp4"
  "seed_long_4.mp4"
  "seed_long_5.mp4"
  "seed_long_6.mp4"
  "seed_long_7.mp4"
  "seed_long_8.mp4"
  "seed_long_9.mp4"
  "seed_long_10.mp4"
  "seed_long_11.mp4"
  "seed_long_12.mp4"
  "seed_long_13.mp4"
  "seed_long_14.mp4"
  "seed_long_15.mp4"
  "seed_long_16.mp4"
  "seed_long_17.mp4"
  "seed_long_18.mp4"
  "seed_long_19.mp4"
  "seed_long_20.mp4"
  "seed_long_21.mp4"
  "seed_long_22.mp4"
  "seed_long_23.mp4"
  "seed_long_24.mp4"
  "seed_long_25.mp4"
  "seed_long_26.mp4"
  "seed_long_27.mp4"
  "seed_long_28.mp4"
  "seed_long_29.mp4"
  "seed_long_30.mp4"
  "seed_long_31.mp4"
  "seed_long_32.mp4"
  "seed_long_33.mp4"
  "seed_long_34.mp4"
  "seed_long_35.mp4"
  "seed_long_36.mp4"
  "seed_long_37.mp4"
  "seed_long_38.mp4"
  "seed_long_39.mp4"
  "seed_long_40.mp4"
  "seed_long_41.mp4"
  "seed_long_42.mp4"
  "seed_long_43.mp4"
  "seed_long_44.mp4"
  "seed_long_45.mp4"
  "seed_long_46.mp4"
  "seed_long_47.mp4"
  "seed_long_48.mp4"
  "seed_long_49.mp4"
  "seed_long_50.mp4"
  "seed_long_51.mp4"
  "seed_long_52.mp4"
  "seed_long_53.mp4"
  "seed_long_54.mp4"
  "seed_long_55.mp4"
  "seed_long_56.mp4"
  "seed_long_57.mp4"
  "seed_long_58.mp4"
  "seed_long_59.mp4"
  "seed_long_60.mp4"
  "seed_long_61.mp4"
  "seed_long_62.mp4"
  "seed_long_63.mp4"
  "seed_long_64.mp4"
  "seed_long_65.mp4"
  "seed_long_66.mp4"
  "seed_long_67.mp4"
  "seed_long_68.mp4"
  "seed_long_69.mp4"
  "seed_long_70.mp4"
  "seed_long_71.mp4"
  "seed_long_72.mp4"
  "seed_long_73.mp4"
  "seed_long_74.mp4"
  "seed_long_75.mp4"
  "seed_long_76.mp4"
  "seed_long_77.mp4"
  "seed_long_78.mp4"
  "seed_long_79.mp4"
  "seed_long_80.mp4"
  "seed_long_81.mp4"
  "seed_long_82.mp4"
  "seed_long_83.mp4"
  "seed_long_84.mp4"
  "seed_long_85.mp4"
  "seed_long_86.mp4"
  "seed_long_87.mp4"
  "seed_long_88.mp4"
  "seed_long_89.mp4"
  "seed_long_90.mp4"
  "seed_long_91.mp4"
  "seed_long_92.mp4"
  "seed_long_93.mp4"
  "seed_long_94.mp4"
  "seed_long_95.mp4"
  "seed_long_96.mp4"
  "seed_long_97.mp4"
  "seed_long_98.mp4"
  "seed_long_99.mp4"
  "seed_long_100.mp4"
)

# List of available short seed videos
SHORT_SEED_VIDEOS=(
  "seed_short_1.mp4"
  "seed_short_2.mp4"
  "seed_short_3.mp4"
  "seed_short_4.mp4"
  "seed_short_5.mp4"
  "seed_short_6.mp4"
  "seed_short_7.mp4"
  "seed_short_8.mp4"
  "seed_short_9.mp4"
  "seed_short_10.mp4"
  "seed_short_11.mp4"
  "seed_short_12.mp4"
  "seed_short_13.mp4"
  "seed_short_14.mp4"
  "seed_short_15.mp4"
  "seed_short_16.mp4"
  "seed_short_17.mp4"
  "seed_short_18.mp4"
  "seed_short_19.mp4"
  "seed_short_20.mp4"
  "seed_short_21.mp4"
  "seed_short_22.mp4"
  "seed_short_23.mp4"
  "seed_short_24.mp4"
  "seed_short_25.mp4"
  "seed_short_26.mp4"
  "seed_short_27.mp4"
  "seed_short_28.mp4"
  "seed_short_29.mp4"
  "seed_short_30.mp4"
  "seed_short_31.mp4"
  "seed_short_32.mp4"
  "seed_short_33.mp4"
  "seed_short_34.mp4"
  "seed_short_35.mp4"
  "seed_short_36.mp4"
  "seed_short_37.mp4"
  "seed_short_38.mp4"
  "seed_short_39.mp4"
  "seed_short_40.mp4"
  "seed_short_41.mp4"
  "seed_short_42.mp4"
  "seed_short_43.mp4"
  "seed_short_44.mp4"
  "seed_short_45.mp4"
  "seed_short_46.mp4"
  "seed_short_47.mp4"
  "seed_short_48.mp4"
  "seed_short_49.mp4"
  "seed_short_50.mp4"
  "seed_short_51.mp4"
  "seed_short_52.mp4"
  "seed_short_53.mp4"
  "seed_short_54.mp4"
  "seed_short_55.mp4"
  "seed_short_56.mp4"
  "seed_short_57.mp4"
  "seed_short_58.mp4"
  "seed_short_59.mp4"
  "seed_short_60.mp4"
  "seed_short_61.mp4"
  "seed_short_62.mp4"
  "seed_short_63.mp4"
  "seed_short_64.mp4"
  "seed_short_65.mp4"
  "seed_short_66.mp4"
  "seed_short_67.mp4"
  "seed_short_68.mp4"
  "seed_short_69.mp4"
  "seed_short_70.mp4"
  "seed_short_71.mp4"
  "seed_short_72.mp4"
  "seed_short_73.mp4"
  "seed_short_74.mp4"
  "seed_short_75.mp4"
  "seed_short_76.mp4"
  "seed_short_77.mp4"
  "seed_short_78.mp4"
  "seed_short_79.mp4"
  "seed_short_80.mp4"
  "seed_short_81.mp4"
  "seed_short_82.mp4"
  "seed_short_83.mp4"
  "seed_short_84.mp4"
  "seed_short_85.mp4"
  "seed_short_86.mp4"
  "seed_short_87.mp4"
  "seed_short_88.mp4"
  "seed_short_89.mp4"
  "seed_short_90.mp4"
  "seed_short_91.mp4"
  "seed_short_92.mp4"
  "seed_short_93.mp4"
  "seed_short_94.mp4"
  "seed_short_95.mp4"
  "seed_short_96.mp4"
  "seed_short_97.mp4"
  "seed_short_98.mp4"
  "seed_short_99.mp4"
  "seed_short_100.mp4"
)

# Validate indices
if [[ $RANDOM_INDEX -ge ${#SEED_VIDEOS[@]} ]]; then
  echo "❌ Invalid long video index: $RANDOM_INDEX (max: $((${#SEED_VIDEOS[@]} - 1)))"
  exit 1
fi

if [[ $RANDOM_INDEX_SHORT -ge ${#SHORT_SEED_VIDEOS[@]} ]]; then
  echo "❌ Invalid short video index: $RANDOM_INDEX_SHORT (max: $((${#SHORT_SEED_VIDEOS[@]} - 1)))"
  exit 1
fi

# Select videos based on provided indices
SELECTED_SEED="${SEED_DIR}${SEED_VIDEOS[$RANDOM_INDEX]}"
echo "🎲 Selected long seed video: $SELECTED_SEED"

SELECTED_SEED_SHORT="${SEED_DIR}${SHORT_SEED_VIDEOS[$RANDOM_INDEX_SHORT]}"
echo "🎲 Selected short seed video: $SELECTED_SEED_SHORT"

# Check if directories exist
if [[ ! -d "$INPUT_DIR" ]]; then
  echo "❌ Input directory does not exist: $INPUT_DIR"
  exit 1
fi

if [[ ! -f "$SELECTED_SEED" ]]; then
  echo "❌ Selected long seed video does not exist: $SELECTED_SEED"
  exit 1
fi

if [[ ! -f "$SELECTED_SEED_SHORT" ]]; then
  echo "❌ Selected short seed video does not exist: $SELECTED_SEED_SHORT"
  exit 1
fi

# Create processed output directory
PROCESSED_DIR="$HOME/suno/outputprocessed"
mkdir -p "$PROCESSED_DIR"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Move and rename output videos to processed directory
if [[ -f "$OUTPUT_VIDEO" ]]; then
  PROCESSED_VIDEO="$PROCESSED_DIR/output_${TIMESTAMP}.mp4"
  mv "$OUTPUT_VIDEO" "$PROCESSED_VIDEO"
  echo "✅ Full video moved to: $PROCESSED_VIDEO"
fi

if [[ -f "$OUTPUT_VIDEO_SHORT" ]]; then
  rm "$OUTPUT_VIDEO_SHORT"
  echo "✅ Short video deleted"
fi

# Clean up previous output files
echo "🧹 Cleaning up previous output files..."
rm -rf "$OUTPUT_VIDEO_FOLDER/*"

# Create output directory if it doesn't exist
OUTPUT_DIR=$(dirname "$OUTPUT_VIDEO")
mkdir -p "$OUTPUT_DIR"

TEMP_DIR=$(mktemp -d)
INPUTS_FILE="$TEMP_DIR/inputs.txt"
COMBINED_WAV="$TEMP_DIR/combined.wav"
LOOPED_VIDEO="$TEMP_DIR/looped_seed.mp4"

# Step 1: List all WAV files
echo "🔍 Searching for WAV files in: $INPUT_DIR"
> "$INPUTS_FILE"
WAV_COUNT=0
for f in "$INPUT_DIR"/*.wav; do
  if [[ -f "$f" ]]; then
    echo "file '$f'" >> "$INPUTS_FILE"
    echo "📝 Found WAV file: $f"
    ((WAV_COUNT++))
  fi
done

if [[ $WAV_COUNT -eq 0 ]]; then
  echo "❌ No WAV files found in $INPUT_DIR"
  exit 1
fi

echo "✅ Found $WAV_COUNT WAV files"

# Step 2: Concatenate all WAVs losslessly
echo "🎵 Concatenating WAV files..."
ffmpeg -y -f concat -safe 0 -i "$INPUTS_FILE" -c copy "$COMBINED_WAV"

if [[ ! -f "$COMBINED_WAV" ]]; then
  echo "❌ Failed to create combined WAV file"
  exit 1
fi

# Step 3: Get audio duration
echo "⏱️ Getting audio duration..."
AUDIO_DURATION=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$COMBINED_WAV")
echo "📊 Audio duration: $AUDIO_DURATION seconds"

# Step 4: Loop the seed video to match audio duration
echo "🎥 Creating looped video..."
ffmpeg -y -stream_loop -1 -i "$SELECTED_SEED" -t "$AUDIO_DURATION" -c copy "$LOOPED_VIDEO"

if [[ ! -f "$LOOPED_VIDEO" ]]; then
  echo "❌ Failed to create looped video"
  exit 1
fi

# Step 5: Combine high-quality audio with looped video
echo "🎬 Combining video and audio with highest quality (M1 GPU accelerated)..."
ffmpeg -y -i "$LOOPED_VIDEO" -i "$COMBINED_WAV" \
  -c:v h264_videotoolbox -allow_sw 1 -b:v 50M -tag:v avc1 \
  -c:a aac -b:a 512k -ar 48000 -ac 2 \
  -map 0:v:0 -map 1:a:0 -movflags +faststart -shortest "$OUTPUT_VIDEO"

if [[ ! -f "$OUTPUT_VIDEO" ]]; then
  echo "❌ Failed to create final video"
  exit 1
fi

echo "✅ Output video saved to: $OUTPUT_VIDEO"

# Step 6: Create a short version of the output video
echo "🎬 Creating short version (max 2 minutes)..."
if [[ -f "$SELECTED_SEED_SHORT" ]]; then
  # Calculate the shorter duration between 2 minutes and the actual audio duration
  if (( $(echo "$AUDIO_DURATION < 165" | bc -l) )); then
    SHORT_DURATION=$AUDIO_DURATION
  else
    # Calculate the range (max - min + 1)
    MIN=150
    MAX=178
    RANGE=$((MAX - MIN + 1))

    # Generate a random number within the range and add the minimum value
    RANDOM_NUMBER=$((RANDOM % RANGE + MIN))

    echo "Generated random number between $MIN and $MAX: $RANDOM_NUMBER"
    SHORT_DURATION=$RANDOM_NUMBER
  fi
  
  # Create short version using the short seed video
  ffmpeg -y -stream_loop -1 -i "$SELECTED_SEED_SHORT" -t "$SHORT_DURATION" -c copy "$TEMP_DIR/looped_short.mp4"
  
  # Combine with audio
  ffmpeg -y -i "$TEMP_DIR/looped_short.mp4" -i "$COMBINED_WAV" \
    -c:v h264_videotoolbox -allow_sw 1 -b:v 50M -tag:v avc1 \
    -c:a aac -b:a 512k -ar 48000 -ac 2 \
    -map 0:v:0 -map 1:a:0 -t "$SHORT_DURATION" -movflags +faststart -shortest "$OUTPUT_VIDEO_SHORT"
  
  if [[ -f "$OUTPUT_VIDEO_SHORT" ]]; then
    echo "✅ Short version saved to: $OUTPUT_VIDEO_SHORT"
  else
    echo "❌ Failed to create short version"
  fi
else
  echo "⚠️ Selected short seed video not found, skipping short version creation"
fi

# Clean up temporary files
echo "🧹 Cleaning up temporary files..."
rm -rf "$TEMP_DIR"

# Move processed WAV files to a backup directory
#BACKUP_DIR="$HOME/suno/processed"
#mkdir -p "$BACKUP_DIR"

echo "📦 Moving processed WAV files to backup..."
for f in "$INPUT_DIR"/*.wav; do
  if [[ -f "$f" ]]; then
    rm "$f"
  fi
done

echo "✅ Cleanup completed"

# Record end time and calculate duration
END_TIME=$(date)
echo "=================================="
echo "🏁 Script completed at: $END_TIME"

# Calculate duration
START_SECONDS=$(date -j -f "%a %b %d %T %Z %Y" "$START_TIME" +%s 2>/dev/null || date -d "$START_TIME" +%s 2>/dev/null || echo $(date +%s))
END_SECONDS=$(date +%s)
DURATION=$((END_SECONDS - START_SECONDS))

# Convert to human readable format
HOURS=$((DURATION / 3600))
MINUTES=$(((DURATION % 3600) / 60))
SECONDS=$((DURATION % 60))

echo "⏱️ Total execution time: ${HOURS}h ${MINUTES}m ${SECONDS}s"
echo "🎉 All done!"