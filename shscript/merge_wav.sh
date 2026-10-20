#!/bin/bash

# Set the source directory - using relative path from script location
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROCESSED_DIR="$HOME/suno/input"

# Check if directory exists
if [ ! -d "$PROCESSED_DIR" ]; then
    echo "Error: Directory $PROCESSED_DIR does not exist"
    exit 1
fi

# Create a temporary file list
TEMP_FILE_LIST="$PROCESSED_DIR/filelist.txt"

# Remove existing file list if it exists
rm -f "$TEMP_FILE_LIST"

# Create the file list
for f in "$PROCESSED_DIR"/*.wav; do
    if [ -f "$f" ]; then
        echo "file '$f'" >> "$TEMP_FILE_LIST"
    fi
done

# Check if we found any WAV files
if [ ! -s "$TEMP_FILE_LIST" ]; then
    echo "Error: No WAV files found in $PROCESSED_DIR"
    rm -f "$TEMP_FILE_LIST"
    exit 1
fi

# Merge the WAV files
ffmpeg -f concat -safe 0 -i "$TEMP_FILE_LIST" -c copy "$PROCESSED_DIR/output.wav"

# Check if ffmpeg was successful
if [ $? -eq 0 ]; then
    echo "Successfully merged WAV files into $PROCESSED_DIR/output.wav"
else
    echo "Error: Failed to merge WAV files"
fi

# Clean up the temporary file
rm -f "$TEMP_FILE_LIST"
