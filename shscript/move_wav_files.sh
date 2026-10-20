#!/bin/bash

# Set the source directory
PROCESSED_DIR="$HOME/suno/processed"

# Check if the directory exists
if [[ ! -d "$PROCESSED_DIR" ]]; then
    echo "❌ Processed directory does not exist: $PROCESSED_DIR"
    exit 1
fi

# Find all .wav files in subdirectories and move them to the main directory
echo "🔍 Searching for .wav files in subdirectories..."
find "$PROCESSED_DIR" -type f -name "*.wav" -mindepth 2 | while read -r file; do
    filename=$(basename "$file")
    echo "📦 Moving: $filename"
    mv "$file" "$PROCESSED_DIR/"
done

echo "✅ All .wav files have been moved to $PROCESSED_DIR" 