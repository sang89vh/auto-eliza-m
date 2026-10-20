from ytmusicapi import YTMusic
import json
from datetime import datetime
import requests

def get_top_songs():
    """Get top songs using search functionality"""
    try:
        ytmusic = YTMusic()
        
        # Use multiple search queries to get a diverse set of songs
        search_queries = [
            "top hits 2020",
            "popular songs 2020",
            "best songs 2020",
            "top hits 2021",
            "popular songs 2021",
            "best songs 2021",
            "top hits 2022",
            "popular songs 2022",
            "best songs 2022",
            "top hits 2023",
            "popular songs 2023",
            "best songs 2023",
            "top hits 2024",
            "popular songs 2024",
            "trending music",
            "top 100 songs",
            "best songs 2024",
            "popular songs 2025",
            "trending songs 2025",
            "top 100 songs 2025",
            "best songs 2025",
            "top songs 2024",
            "popular songs 2024",
            "trending songs 2024",
        ]
        
        all_songs = []
        seen_songs = set()  # To avoid duplicates
        
        for query in search_queries:
            print(f"\nSearching for: {query}")
            results = ytmusic.search(query, filter="songs", limit=500)
            
            if results:
                for song in results:
                    title = song.get('title', '').strip()
                    artists = ', '.join([artist['name'] for artist in song.get('artists', [])])
                    
                    # Create unique identifier to avoid duplicates
                    song_id = f"{title.lower()} - {artists.lower()}"
                    
                    if song_id not in seen_songs:
                        seen_songs.add(song_id)
                        all_songs.append(song)
        
        return all_songs
    except Exception as e:
        print(f"Error getting songs: {e}")
        return []

def format_song_data(songs):
    """Format song data for display and API call"""
    formatted_songs = []
    original_titles = []
    
    for i, song in enumerate(songs, 1):
        try:
            # Get artist names
            artists = ', '.join([artist['name'] for artist in song.get('artists', [])]) if song.get('artists') else 'Unknown Artist'
            title = song.get('title', 'Unknown')
            
            # Create original_title in format "title - artist"
            original_title = f"{title} - {artists}"
            
            # Skip if title or artist is empty/unknown
            if title == 'Unknown' or artists == 'Unknown Artist':
                continue
                
            original_titles.append(original_title)
            
            song_info = {
                'rank': i,
                'title': title,
                'artist': artists,
                'duration': song.get('duration', 'N/A'),
                'video_id': song.get('videoId', ''),
                'youtube_url': f"https://music.youtube.com/watch?v={song.get('videoId', '')}",
                'original_title': original_title
            }
            
            formatted_songs.append(song_info)
        except Exception as e:
            print(f"Error formatting song {i}: {e}")
            continue
    
    return formatted_songs, original_titles

def call_init_songs_api(original_titles, batch_size=50):
    """Call the init-songs API with batches of original titles"""
    try:
        # Split into batches to avoid too large requests
        for i in range(0, len(original_titles), batch_size):
            batch = original_titles[i:i + batch_size]
            
            print(f"\nSending batch {i//batch_size + 1} ({len(batch)} songs)...")
            
            response = requests.post(
                'http://localhost:3001/api/init-songs',
                headers={'Content-Type': 'application/json'},
                json={'original_titles': batch}
            )
            
            if response.status_code != 200:
                print(f"API call failed for batch {i//batch_size + 1}: {response.status_code}")
                print(f"Response: {response.text}")
            else:
                print(f"Successfully sent batch {i//batch_size + 1} to API")
                
    except Exception as e:
        print(f"Error calling API: {e}")

def main():
    print("🎵 YouTube Music - Top Songs Fetcher\n")
    
    # Get songs using search
    print("=== FETCHING TOP SONGS ===")
    songs = get_top_songs()
    
    if songs:
        # Format songs and get original titles
        formatted_songs, original_titles = format_song_data(songs)
        
        print(f"\nFound {len(formatted_songs)} unique songs!")
        print("\nSample of songs found:")
        for song in formatted_songs[:10]:  # Show first 10 songs as sample
            print(f"{song['rank']:2d}. {song['original_title']}")
            print(f"    🎵 {song['youtube_url']}")
            print()
        
        # Call API with all collected songs
        if original_titles:
            print(f"\nSending {len(original_titles)} songs to API...")
            call_init_songs_api(original_titles)
        else:
            print("\nNo valid songs found to send to API")
    else:
        print("No songs found!")

if __name__ == "__main__":
    try:
        main()
    except ImportError:
        print("❌ ytmusicapi not found!")
        print("\nTo install required packages:")
        print("pip install ytmusicapi requests")
    except Exception as e:
        print(f"An error occurred: {e}")
