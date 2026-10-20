import os
import json
import requests
from pathlib import Path
from typing import List

def read_bplist_as_json(file_path):
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            # Read the file content and parse as JSON
            content = f.read()
            # Remove any BOM or special characters at the start
            content = content.lstrip('\ufeff')
            # Remove trailing commas before closing brackets/braces
            content = content.replace(',]', ']').replace(',}', '}')
            return json.loads(content)
    except Exception as e:
        print(f"Error reading {file_path}: {e}")
        return None

def process_batch(original_titles: List[str], batch_size: int = 10):
    """Process songs in batches of specified size"""
    for i in range(0, len(original_titles), batch_size):
        batch = original_titles[i:i + batch_size]
        try:
            response = requests.post(
                'http://localhost:3001/api/init-songs',
                headers={'Content-Type': 'application/json'},
                json={'original_titles': batch}
            )
            if response.status_code == 201:
                print(f"Successfully inserted batch of {len(batch)} songs")
            else:
                print(f"Error inserting songs: {response.json()}")
        except Exception as e:
            print(f"Error calling API: {e}")

def process_playlist(file_path):
    data = read_bplist_as_json(file_path)
    if not data:
        return
    
    # Extract songs and format original titles
    original_titles = []
    for song in data.get('songs', []):
        song_name = song.get('songName', '')
        author_name = song.get('levelAuthorName', '')
        if song_name and author_name:
            original_title = f"{song_name} - {author_name}"
            original_titles.append(original_title)
    
    if original_titles:
        print(f"\nProcessing {len(original_titles)} songs from {os.path.basename(file_path)}")
        process_batch(original_titles)

def main():
    data_dir = Path(__file__).parent / 'data'
    print(f"\nProcessing {data_dir}...")
    # Process all .bplist files in the data directory
    for file_path in data_dir.glob('*.json'):
        print(f"\nProcessing {file_path.name}...")
        process_playlist(file_path)

if __name__ == '__main__':
    main() 