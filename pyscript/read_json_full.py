import os
import json
import requests
from pathlib import Path
from typing import List

API_URL = 'http://localhost:3001/api/songs'

def read_json_file(file_path):
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
            content = content.lstrip('\ufeff')
            content = content.replace(',]', ']').replace(',}', '}')
            return json.loads(content)
    except Exception as e:
        print(f"Error reading {file_path}: {e}")
        return None

def insert_song(song):
    payload = {
        'title': song.get('title', ''),
        'lyrics': song.get('lyrics', ''),
        'original_title': song.get('title', ''),
        'styles': song.get('styles', ''),
        'youtube_song_introduction': song.get('youtube_intro', '')
    }
    try:
        response = requests.post(API_URL, json=payload)
        if response.status_code in (200, 201):
            print(f"Inserted/Updated: {payload['title']}")
        else:
            print(f"Error inserting {payload['title']}: {response.status_code} {response.text}")
    except Exception as e:
        print(f"Exception inserting {payload['title']}: {e}")

def process_8x9x_json(file_path):
    data = read_json_file(file_path)
    if not data:
        print("No data loaded.")
        return
    print(f"Processing {len(data)} songs from {os.path.basename(file_path)}...")
    for song in data:
        insert_song(song)

def main():
    data_dir = Path(__file__).parent.parent / 'data'
    file_path = data_dir / '8x9x.json'
    print(f"\nProcessing {file_path}...")
    process_8x9x_json(file_path)

if __name__ == '__main__':
    main() 