import speech_recognition as sr
import wave
import math
from datetime import timedelta
import os

def wav_to_srt(wav_file_path, srt_file_path, chunk_duration=10):
    """
    Convert WAV audio file to SRT subtitle file
    
    Args:
        wav_file_path (str): Path to input WAV file
        srt_file_path (str): Path to output SRT file
        chunk_duration (int): Duration of each subtitle chunk in seconds
    """
    
    # Initialize speech recognizer
    r = sr.Recognizer()
    
    # Open the WAV file
    with wave.open(wav_file_path, 'rb') as wav_file:
        frames = wav_file.getnframes()
        sample_rate = wav_file.getframerate()
        duration = frames / float(sample_rate)
    
    print(f"Audio duration: {duration:.2f} seconds")
    
    # Calculate number of chunks
    num_chunks = math.ceil(duration / chunk_duration)
    
    subtitles = []
    
    for i in range(num_chunks):
        start_time = i * chunk_duration
        end_time = min((i + 1) * chunk_duration, duration)
        
        print(f"Processing chunk {i+1}/{num_chunks} ({start_time:.1f}s - {end_time:.1f}s)")
        
        # Load audio chunk
        with sr.AudioFile(wav_file_path) as source:
            # Record the audio chunk
            audio = r.record(source, offset=start_time, duration=end_time-start_time)
        
        try:
            # Recognize speech using Google Speech Recognition
            text = r.recognize_google(audio)
            
            if text.strip():  # Only add non-empty text
                subtitle = {
                    'index': len(subtitles) + 1,
                    'start_time': start_time,
                    'end_time': end_time,
                    'text': text
                }
                subtitles.append(subtitle)
                print(f"  Recognized: {text}")
            else:
                print("  No speech detected")
                
        except sr.UnknownValueError:
            print("  Could not understand audio")
        except sr.RequestError as e:
            print(f"  Error with speech recognition service: {e}")
    
    # Write SRT file
    write_srt_file(subtitles, srt_file_path)
    print(f"\nSRT file saved to: {srt_file_path}")

def format_time(seconds):
    """Convert seconds to SRT time format (HH:MM:SS,mmm)"""
    td = timedelta(seconds=seconds)
    hours, remainder = divmod(td.seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    milliseconds = td.microseconds // 1000
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{milliseconds:03d}"

def write_srt_file(subtitles, output_path):
    """Write subtitles to SRT file"""
    with open(output_path, 'w', encoding='utf-8') as f:
        for subtitle in subtitles:
            f.write(f"{subtitle['index']}\n")
            f.write(f"{format_time(subtitle['start_time'])} --> {format_time(subtitle['end_time'])}\n")
            f.write(f"{subtitle['text']}\n\n")

def main():
    # Example usage
    wav_file = "input_audio.wav"  # Replace with your WAV file path
    srt_file = "output_subtitles.srt"  # Replace with desired output path
    
    # Check if input file exists
    if not os.path.exists(wav_file):
        print(f"Error: WAV file '{wav_file}' not found!")
        print("Please update the 'wav_file' variable with the correct path to your WAV file.")
        return
    
    try:
        wav_to_srt(wav_file, srt_file, chunk_duration=10)
        print("Conversion completed successfully!")
    except Exception as e:
        print(f"Error during conversion: {e}")

if __name__ == "__main__":
    main()

# pip install SpeechRecognition