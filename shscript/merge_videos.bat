@echo off
setlocal EnableDelayedExpansion

rem Get current date in yyyyMMdd format
for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value') do set datetime=%%I
set datestamp=%datetime:~0,8%

rem Create a temporary file listing all MP4 files
if exist "temp_file_list.txt" del "temp_file_list.txt"
for %%F in ("D:\suno\outputprocessed\*.mp4") do (
    echo file '%%F' >> "temp_file_list.txt"
)

rem Check if any MP4 files were found
if not exist "temp_file_list.txt" (
    echo No MP4 files found in D:\suno\outputprocessed
    goto :end
)

rem Merge all files using FFmpeg
ffmpeg -f concat -safe 0 -i "temp_file_list.txt" -c:v h264_nvenc -preset slow -c:a aac -b:a 320k -ar 48000 -pix_fmt yuv420p -movflags +faststart -cq 23 -vsync 2 -async 1 -max_muxing_queue_size 1024 -y "E:\suno\merged\%datestamp%_merged.mp4"

rem Check if merge was successful
if %ERRORLEVEL% EQU 0 (
    echo Merge completed successfully. Deleting input files...
    for %%F in ("D:\suno\outputprocessed\*.mp4") do (
        rem move to backup folder
        if not "%%~nxF"=="%datestamp%_merged.mp4" (
            move "%%F" E:\suno\outputprocessed
            echo Move %%F to backup folder 
        )
    )
    echo Input files deleted.
) else (
    echo Merge failed. Input files were not deleted.
)

rem Clean up temporary file
del "temp_file_list.txt"

echo Process complete! Output file: %datestamp%_merged.mp4

:end
endlocal 