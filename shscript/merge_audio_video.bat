REM Debug print arguments
@echo off
chcp 65001
setlocal enabledelayedexpansion

echo 1: %1
echo 2: %2
echo 3: %3
echo 4: %4
echo 5: %5

REM Usage:
REM merge_audio_video.bat <long_video_index> <short_video_index> <drawtext_text>
REM Example: merge_audio_video.bat 3 1 "hello to code"

if "%~2"=="" (
    echo Usage: merge_audio_video.bat ^<long_video_index^> ^<short_video_index^> ^<drawtext_text^>
    exit /b 1
)

REM Check for required arguments
if "%~5"=="" (
    echo Usage: merge_audio_video.bat ^<long_video_index^> ^<short_video_index^> ^<filter_af_type^> ^<drawtext_text^> ^<tempo^>
    exit /b 1
)

set RANDOM_INDEX=%1
set RANDOM_INDEX_SHORT=%2
set DRAWTEXT_TEXT=%3

REM Remove all double quotes from DRAWTEXT_TEXT
set DRAWTEXT_TEXT=%DRAWTEXT_TEXT:"=%

set FILTER_AF_TYPE=%4
set TEMPO=%5

echo =======================================
echo DRAWTEXT_TEXT %DRAWTEXT_TEXT%
echo FILTER_AF_TYPE %FILTER_AF_TYPE%
echo TEMPO %TEMPO%
echo ==============================================

REM Ensure indexes are at least 1
if %RANDOM_INDEX%==0 set RANDOM_INDEX=1
if %RANDOM_INDEX_SHORT%==0 set RANDOM_INDEX_SHORT=1
REM if %RANDOM_INDEX% gtr 100 set RANDOM_INDEX=1
REM if %RANDOM_INDEX_SHORT% gtr 100 set RANDOM_INDEX_SHORT=1

REM Arguments
set INPUT_DIR=D:\suno\input
set SEED_DIR=E:\suno\seed
set OUTPUT_VIDEO=D:\suno\output\output.mp4
set OUTPUT_VIDEO_TMP=D:\suno\output\output_tmp.mp4
set OUTPUT_VIDEO_FINAL=D:\suno\output\final_output.mp4
set OUTPUT_VIDEO_SHORT=D:\suno\output\output_short.mp4

REM Set drawtext text from 3rd argument
set DRAWTEXT_FONT=C:\\Windows\\Fonts\\arial.ttf
set SHORT_TIME_VIDEOS[1]=150
set SHORT_TIME_VIDEOS[2]=151
set SHORT_TIME_VIDEOS[3]=152
set SHORT_TIME_VIDEOS[4]=153
set SHORT_TIME_VIDEOS[5]=154
set SHORT_TIME_VIDEOS[6]=155
set SHORT_TIME_VIDEOS[7]=156
set SHORT_TIME_VIDEOS[8]=157
set SHORT_TIME_VIDEOS[9]=158
set SHORT_TIME_VIDEOS[10]=159
set SHORT_TIME_VIDEOS[11]=160
set SHORT_TIME_VIDEOS[12]=161
set SHORT_TIME_VIDEOS[13]=162
set SHORT_TIME_VIDEOS[14]=163
set SHORT_TIME_VIDEOS[15]=164
set SHORT_TIME_VIDEOS[16]=165
set SHORT_TIME_VIDEOS[17]=166
set SHORT_TIME_VIDEOS[18]=167
set SHORT_TIME_VIDEOS[19]=168
set SHORT_TIME_VIDEOS[20]=169
set SHORT_TIME_VIDEOS[21]=170
set SHORT_TIME_VIDEOS[22]=171
set SHORT_TIME_VIDEOS[23]=172
set SHORT_TIME_VIDEOS[24]=173
set SHORT_TIME_VIDEOS[25]=174
set SHORT_TIME_VIDEOS[26]=175
set SHORT_TIME_VIDEOS[27]=176
set SHORT_TIME_VIDEOS[28]=177
set SHORT_TIME_VIDEOS[29]=178
set SHORT_TIME_VIDEOS[30]=130
set SHORT_TIME_VIDEOS[31]=131
set SHORT_TIME_VIDEOS[32]=132
set SHORT_TIME_VIDEOS[33]=133
set SHORT_TIME_VIDEOS[34]=134
set SHORT_TIME_VIDEOS[35]=135
set SHORT_TIME_VIDEOS[36]=136
set SHORT_TIME_VIDEOS[37]=137
set SHORT_TIME_VIDEOS[38]=138
set SHORT_TIME_VIDEOS[39]=139
set SHORT_TIME_VIDEOS[40]=140
set SHORT_TIME_VIDEOS[41]=141
set SHORT_TIME_VIDEOS[42]=142
set SHORT_TIME_VIDEOS[43]=143
set SHORT_TIME_VIDEOS[44]=144
set SHORT_TIME_VIDEOS[45]=145
set SHORT_TIME_VIDEOS[46]=146
set SHORT_TIME_VIDEOS[47]=147
set SHORT_TIME_VIDEOS[48]=148
set SHORT_TIME_VIDEOS[49]=149
set SHORT_TIME_VIDEOS[50]=150
set SHORT_TIME_VIDEOS[51]=120
set SHORT_TIME_VIDEOS[52]=121
set SHORT_TIME_VIDEOS[53]=122
set SHORT_TIME_VIDEOS[54]=123
set SHORT_TIME_VIDEOS[55]=124
set SHORT_TIME_VIDEOS[56]=125
set SHORT_TIME_VIDEOS[57]=126
set SHORT_TIME_VIDEOS[58]=127
set SHORT_TIME_VIDEOS[59]=128
set SHORT_TIME_VIDEOS[60]=129
set SHORT_TIME_VIDEOS[61]=130
set SHORT_TIME_VIDEOS[62]=131
set SHORT_TIME_VIDEOS[63]=132
set SHORT_TIME_VIDEOS[64]=133
set SHORT_TIME_VIDEOS[65]=134
set SHORT_TIME_VIDEOS[66]=135
set SHORT_TIME_VIDEOS[67]=136
set SHORT_TIME_VIDEOS[68]=137
set SHORT_TIME_VIDEOS[69]=138
set SHORT_TIME_VIDEOS[70]=139
set SHORT_TIME_VIDEOS[71]=140
set SHORT_TIME_VIDEOS[72]=141
set SHORT_TIME_VIDEOS[73]=142
set SHORT_TIME_VIDEOS[74]=143
set SHORT_TIME_VIDEOS[75]=144
set SHORT_TIME_VIDEOS[76]=145
set SHORT_TIME_VIDEOS[77]=146
set SHORT_TIME_VIDEOS[78]=147
set SHORT_TIME_VIDEOS[79]=148
set SHORT_TIME_VIDEOS[80]=100
set SHORT_TIME_VIDEOS[81]=101
set SHORT_TIME_VIDEOS[82]=102
set SHORT_TIME_VIDEOS[83]=103
set SHORT_TIME_VIDEOS[84]=104
set SHORT_TIME_VIDEOS[85]=105
set SHORT_TIME_VIDEOS[86]=106
set SHORT_TIME_VIDEOS[87]=107
set SHORT_TIME_VIDEOS[88]=108
set SHORT_TIME_VIDEOS[89]=109
set SHORT_TIME_VIDEOS[90]=110
set SHORT_TIME_VIDEOS[91]=111
set SHORT_TIME_VIDEOS[92]=112
set SHORT_TIME_VIDEOS[93]=113
set SHORT_TIME_VIDEOS[94]=114
set SHORT_TIME_VIDEOS[95]=115
set SHORT_TIME_VIDEOS[96]=116
set SHORT_TIME_VIDEOS[97]=117
set SHORT_TIME_VIDEOS[98]=118
set SHORT_TIME_VIDEOS[99]=119
set SHORT_TIME_VIDEOS[100]=120
REM Trim leading/trailing spaces from FILTER_AF_TYPE
for /f "tokens=* delims= " %%a in ("%FILTER_AF_TYPE%") do set FILTER_AF_TYPE=%%a

REM set TREMOLO=

REM if not "%TEMPO%"=="" (
REM     set TREMOLO=tremolo=f=%TEMPO%:d=0.9,
REM ) else (
REM     set TREMOLO=
REM )

echo FILTER_AF_TYPE: '%FILTER_AF_TYPE%'
REM Assign FILTER_AF_VALUE based on FILTER_AF_TYPE

if /I "%FILTER_AF_TYPE%"=="ProgressiveHouse" (
    echo FILTER_AF_VALUE for ProgressiveHouse
    set FILTER_AF_VALUE=volume=-6dB,highpass=f=30,equalizer=f=50:t=q:w=1:g=3,equalizer=f=80:t=q:w=1:g=2,equalizer=f=2500:t=q:w=1:g=1.5,equalizer=f=4000:t=q:w=1:g=1,equalizer=f=8000:t=q:w=1:g=0.5,aexciter=level_in=1:level_out=1:amount=0.8:drive=4:freq=6000:ceil=12000,extrastereo=m=1.05,compand=attacks=0.1:decays=0.8:points=-80/-80\,-20/-15\,-10/-8\,-5/-5\,0/-3:soft-knee=3:gain=0:volume=0:delay=0,loudnorm=I=-14:LRA=11:TP=-1.5,alimiter=limit=0.95
) else if /I "%FILTER_AF_TYPE%"=="TropicalHouse" (
    echo FILTER_AF_VALUE for TropicalHouse
    set FILTER_AF_VALUE=volume=-6dB,highpass=f=30,equalizer=f=45:t=q:w=1:g=2,equalizer=f=80:t=q:w=1:g=1.5,equalizer=f=150:t=q:w=1:g=0.5,equalizer=f=3000:t=q:w=1:g=1,equalizer=f=6000:t=q:w=1:g=0.5,asoftclip=type=tanh:threshold=0.98,extrastereo=m=1.05,compand=attacks=0.1:decays=0.8:points=-80/-80\,-20/-15\,-10/-8\,-5/-5\,0/-3:soft-knee=3:gain=0:volume=0:delay=0,loudnorm=I=-16:LRA=11:TP=-1.5,alimiter=limit=0.95
) else if /I "%FILTER_AF_TYPE%"=="BigRoomRave" (
    echo FILTER_AF_VALUE for BigRoomRave
    set FILTER_AF_VALUE=volume=-6dB,highpass=f=25,equalizer=f=50:t=q:w=1:g=4,equalizer=f=80:t=q:w=1:g=3,equalizer=f=150:t=q:w=1:g=1.5,equalizer=f=3000:t=q:w=1:g=2,equalizer=f=5000:t=q:w=1:g=1.5,equalizer=f=10000:t=q:w=1:g=1,compand=attacks=0.05:decays=0.5:points=-80/-80\,-25/-20\,-15/-10\,-8/-6\,-3/-3\,0/-2:soft-knee=2:gain=0:volume=0:delay=0,loudnorm=I=-12:LRA=8:TP=-1.5,alimiter=limit=0.95
) else if /I "%FILTER_AF_TYPE%"=="DeepHouse" (
    echo FILTER_AF_VALUE for DeepHouse
    set FILTER_AF_VALUE=volume=-6dB,highpass=f=25,equalizer=f=40:t=q:w=1:g=2.5,equalizer=f=70:t=q:w=1:g=2,equalizer=f=120:t=q:w=1:g=1,equalizer=f=1500:t=q:w=1:g=0.5,equalizer=f=3000:t=q:w=1:g=0.5,equalizer=f=8000:t=q:w=1:g=0.2,asoftclip=type=tanh:threshold=0.95,extrastereo=m=1.02,compand=attacks=0.2:decays=1.2:points=-80/-80\,-18/-12\,-10/-8\,-5/-5\,0/-3:soft-knee=4:gain=0:volume=0:delay=0,loudnorm=I=-18:LRA=12:TP=-1.5,alimiter=limit=0.95
) else if /I "%FILTER_AF_TYPE%"=="ElectroPop" (
    echo FILTER_AF_VALUE for ElectroPop
    set FILTER_AF_VALUE=volume=-6dB,highpass=f=28,equalizer=f=40:t=q:w=1:g=3,equalizer=f=70:t=q:w=1:g=2.5,equalizer=f=120:t=q:w=1:g=2,equalizer=f=2800:t=q:w=1:g=2,equalizer=f=4500:t=q:w=1:g=1.5,equalizer=f=8000:t=q:w=1:g=1.5,equalizer=f=12000:t=q:w=1:g=1,aexciter=level_in=1:level_out=1:amount=1:drive=5:freq=6000:ceil=12000,extrastereo=m=1.1,compand=attacks=0.1:decays=0.8:points=-80/-80\,-20/-15\,-10/-8\,-5/-5\,0/-3:soft-knee=3:gain=0:volume=0:delay=0,loudnorm=I=-14:LRA=9:TP=-1.5,alimiter=limit=0.95
) else if /I "%FILTER_AF_TYPE%"=="MelodicTechno" (
    echo FILTER_AF_VALUE for MelodicTechno
    set FILTER_AF_VALUE=volume=-5dB,highpass=f=30,equalizer=f=60:t=q:w=0.8:g=1.5,equalizer=f=100:t=q:w=1:g=1,equalizer=f=200:t=q:w=1.2:g=0.5,equalizer=f=800:t=q:w=2:g=-0.3,equalizer=f=2000:t=q:w=1.5:g=1,equalizer=f=4000:t=q:w=1:g=1.5,equalizer=f=8000:t=q:w=1:g=1,equalizer=f=12000:t=q:w=1:g=0.5,aexciter=level_in=1:level_out=1:amount=1.2:drive=4:freq=5000:ceil=10000,asoftclip=type=tanh:threshold=0.9,compand=attacks=0.2:decays=1:points=-80/-80\,-25/-18\,-15/-10\,-8/-6\,-3/-3\,0/-2:soft-knee=4:gain=0:volume=0:delay=0,extrastereo=m=1.08,loudnorm=I=-14:LRA=9:TP=-1.5,alimiter=limit=0.95
) else (
    echo FILTER_AF_VALUE for default
    set FILTER_AF_VALUE=volume=-6dB,highpass=f=28,equalizer=f=40:t=q:w=1:g=3,equalizer=f=70:t=q:w=1:g=2.5,equalizer=f=120:t=q:w=1:g=2,equalizer=f=2800:t=q:w=1:g=2,equalizer=f=4500:t=q:w=1:g=1.5,equalizer=f=8000:t=q:w=1:g=1.5,equalizer=f=12000:t=q:w=1:g=1,aexciter=level_in=1:level_out=1:amount=1:drive=5:freq=6000:ceil=12000,extrastereo=m=1.1,compand=attacks=0.1:decays=0.8:points=-80/-80\,-20/-15\,-10/-8\,-5/-5\,0/-3:soft-knee=3:gain=0:volume=0:delay=0,loudnorm=I=-14:LRA=9:TP=-1.5,alimiter=limit=0.95
)

echo =========================================================================
echo FILTER_AF_VALUE %FILTER_AF_VALUE%
echo =========================================================================



if "%FILTER_AF_VALUE%"=="" (
    echo ERROR: FILTER_AF_VALUE is empty!
    exit /b 1
)

REM Get selected videos
if %RANDOM_INDEX_SHORT% gtr 99 {
    call set SELECTED_SHORT_TIME_VIDEOS=148
}else (
    call set SELECTED_SHORT_TIME_VIDEOS=%%SHORT_TIME_VIDEOS[%RANDOM_INDEX_SHORT%]%%
)

set SELECTED_SEED=%SEED_DIR%\seed_long_%RANDOM_INDEX%.mp4
set SELECTED_SEED_SHORT=%SEED_DIR%\seed_short_%RANDOM_INDEX_SHORT%.mp4

REM check if the seed video exists
if not exist "%SELECTED_SEED%" (
    echo Error: Selected seed video %SELECTED_SEED% does not exist
    set SELECTED_SEED=%SEED_DIR%\seed_long_1.mp4
    echo Using fallback video: !SELECTED_SEED!
)

if not exist "%SELECTED_SEED_SHORT%" (
    echo Error: Selected short seed video %SELECTED_SEED_SHORT% does not exist
    set SELECTED_SEED_SHORT=%SEED_DIR%\seed_short_1.mp4
    echo Using fallback video: !SELECTED_SEED_SHORT!
)

REM Check if fallback videos exist
if not exist "%SELECTED_SEED%" (
    echo Error: Even fallback seed video does not exist
    exit /b 1
)

if not exist "%SELECTED_SEED_SHORT%" (
    echo Error: Even fallback short seed video does not exist
    exit /b 1
)

REM Check if directories exist
if not exist "%INPUT_DIR%" (
    echo Error: Input directory %INPUT_DIR% does not exist
    exit /b 1
)

REM Create processed output directory
set PROCESSED_DIR=D:\suno\outputprocessed
if not exist "%PROCESSED_DIR%" mkdir "%PROCESSED_DIR%"

REM Create timestamp
for /f "tokens=2 delims==" %%a in ('wmic OS Get localdatetime /value') do set "dt=%%a"
set "YY=%dt:~2,2%" & set "YYYY=%dt:~0,4%" & set "MM=%dt:~4,2%" & set "DD=%dt:~6,2%"
set "HH=%dt:~8,2%" & set "Min=%dt:~10,2%" & set "Sec=%dt:~12,2%"
set "TIMESTAMP=%YYYY%%MM%%DD%_%HH%%Min%%Sec%"

REM Move and rename output videos to processed directory
if exist "%OUTPUT_VIDEO%" (
    set PROCESSED_VIDEO=%PROCESSED_DIR%\output_%TIMESTAMP%.mp4
    move "%OUTPUT_VIDEO%" "!PROCESSED_VIDEO!"
    echo Deleted existing output video to !PROCESSED_VIDEO!
)
if exist "%OUTPUT_VIDEO_FINAL%" (
    del "%OUTPUT_VIDEO_FINAL%"
    echo Deleted existing final output video !OUTPUT_VIDEO_FINAL!
)

if exist "%OUTPUT_VIDEO_SHORT%" (
    set PROCESSED_VIDEO_SHORT=%PROCESSED_DIR%\output_short_%TIMESTAMP%.mp4
    del "%OUTPUT_VIDEO_SHORT%"
    echo Deleted existing short output video to !PROCESSED_VIDEO_SHORT!
)

REM Create output directory if it doesn't exist
for %%i in ("%OUTPUT_VIDEO%") do set "OUTPUT_DIR=%%~dpi"
if not exist "%OUTPUT_DIR%" mkdir "%OUTPUT_DIR%"

REM Create temporary directory
set TEMP_DIR=D:\tmp\merge_audio_%RANDOM%
mkdir "%TEMP_DIR%"
set INPUTS_FILE=%TEMP_DIR%\inputs.txt
set COMBINED_WAV=%TEMP_DIR%\combined.wav
set LOOPED_VIDEO=%TEMP_DIR%\looped_seed.mp4

echo Using temporary directory: %TEMP_DIR%

REM Step 1: Instead of using concat filter, merge audio directly with multiple inputs
echo. > "%INPUTS_FILE%"
REM Count WAV files
set WAV_COUNT=0
for %%f in ("%INPUT_DIR%\*.wav") do (
    if exist "%%f" (
        set /a WAV_COUNT+=1
    )
)

if %WAV_COUNT%==0 (
    echo Error: No WAV files found in %INPUT_DIR%
    rmdir /s /q "%TEMP_DIR%"
    exit /b 1
)

REM If only one file, clone it as clone.wav so there are two files
if %WAV_COUNT%==1 (
    for %%f in ("%INPUT_DIR%\*.wav") do (
        copy "%%f" "%INPUT_DIR%\clone.wav"
    )
    set /a WAV_COUNT=2
)

REM Now always run the concat logic for 2+ files
setlocal enabledelayedexpansion
set FFMPEG_INPUTS=
set FILTER_LABELS=
set idx=0
for %%f in ("%INPUT_DIR%\*.wav") do (
    set FFMPEG_INPUTS=!FFMPEG_INPUTS! -i "%%f"
    set FILTER_LABELS=!FILTER_LABELS![!idx!:a]
    set /a idx+=1
)
endlocal & set FFMPEG_INPUTS=%FFMPEG_INPUTS% & set FILTER_LABELS=%FILTER_LABELS%
set FILTER_COMPLEX=%FILTER_LABELS%concat=n=%WAV_COUNT%:v=0:a=1[aud],[aud]%FILTER_AF_VALUE%[out]

echo FILTER_COMPLEX %FILTER_COMPLEX%
echo =========================================================================
echo ffmpeg -y %FFMPEG_INPUTS% -filter_complex "%FILTER_COMPLEX%" -map "[out]" -c:a pcm_s24le "%COMBINED_WAV%"
echo =========================================================================
ffmpeg -y %FFMPEG_INPUTS% -filter_complex "%FILTER_COMPLEX%" -map "[out]" -c:a pcm_s24le "%COMBINED_WAV%"

if not exist "%COMBINED_WAV%" (
    echo Error: Failed to create combined WAV file
    rmdir /s /q "%TEMP_DIR%"
    exit /b 1
)

REM Step 3: Get audio duration
echo Getting audio duration...
for /f %%i in ('ffprobe -v error -show_entries format^=duration -of default^=noprint_wrappers^=1:nokey^=1 "%COMBINED_WAV%"') do set AUDIO_DURATION=%%i
echo Audio duration: %AUDIO_DURATION% seconds

REM Step 4: Loop the seed video to match audio duration with GPU acceleration
echo Creating looped video...
ffmpeg -y -hwaccel cuda -stream_loop -1 -i "%SELECTED_SEED%" -t %AUDIO_DURATION% -c:v h264_nvenc -preset slow -c copy "%LOOPED_VIDEO%"

if not exist "%LOOPED_VIDEO%" (
    echo Error: Failed to create looped video
    rmdir /s /q "%TEMP_DIR%"
    exit /b 1
)

echo Combining audio and video...

echo Escape single quotes in DRAWTEXT_TEXT for ffmpeg compatibility
set "DRAWTEXT_TEXT_ESC=%DRAWTEXT_TEXT:'=\'%"

echo DRAWTEXT_TEXT_ESC result: %DRAWTEXT_TEXT_ESC%

REM Build drawtext filter only if DRAWTEXT_TEXT is not empty
echo =========================================================================
echo ffmpeg -y -hwaccel cuda -i "%LOOPED_VIDEO%" -i "%COMBINED_WAV%" -vf "drawtext=fontfile='C\:/Windows/fonts/arial.ttf':text='%DRAWTEXT_TEXT_ESC%':fontsize=60:fontcolor=white:x=w-mod(t*150\,w+text_w):y=h-60,scale=1920:1080" -c:v h264_nvenc -preset slow -b:v 8000k -rc vbr -cq 18 -profile:v high -pix_fmt yuv420p -r 30 -c:a aac -b:a 512k -ar 48000 -map 0:v:0 -map 1:a:0 -movflags +faststart -shortest "%OUTPUT_VIDEO%"
echo =========================================================================
ffmpeg -y -hwaccel cuda -i "%LOOPED_VIDEO%" -i "%COMBINED_WAV%" -vf "drawtext=fontfile='C\:/Windows/fonts/arial.ttf':text='%DRAWTEXT_TEXT_ESC%':fontsize=60:fontcolor=white:x=w-mod(t*150\,w+text_w):y=h-60,scale=1920:1080" -c:v h264_nvenc -preset slow -b:v 8000k -rc vbr -cq 18 -profile:v high -pix_fmt yuv420p -r 30 -c:a aac -b:a 512k -ar 48000 -map 0:v:0 -map 1:a:0 -movflags +faststart -shortest "%OUTPUT_VIDEO%"


if not exist "%OUTPUT_VIDEO%" (
    echo Error: Failed to create final output video
    rmdir /s /q "%TEMP_DIR%"
    exit /b 1
)

echo Created output video: %OUTPUT_VIDEO%

REM Step 6: Create a short version of the output video with GPU acceleration
if exist "%SELECTED_SEED_SHORT%" (
    echo Creating short version...
    
    REM Calculate the shorter duration between 2 minutes and the actual audio duration
    REM Using PowerShell for floating point comparison
    for /f %%i in ('powershell -command "if ([double]%AUDIO_DURATION% -lt 169) { %AUDIO_DURATION% } else { %SELECTED_SHORT_TIME_VIDEOS% }"') do set SHORT_DURATION=%%i
    
    echo Short version duration: !SHORT_DURATION! seconds
    
    REM Create short version using the short seed video with GPU acceleration
    echo Creating looped short video...
    REM ffmpeg -y -hwaccel cuda -stream_loop -1 -i "%SELECTED_SEED_SHORT%" -t !SHORT_DURATION! -c:v h264_nvenc -preset slow -c copy "%TEMP_DIR%\looped_short.mp4"
    
    REM Combine with audio using GPU acceleration
    echo Combining short video with audio...
    
    REM Combine with audio using GPU acceleration
    echo =========================================================================
    REM ffmpeg -y -hwaccel cuda -i "%TEMP_DIR%\looped_short.mp4" -i "%COMBINED_WAV%" -vf "drawtext=fontfile='C\:/Windows/fonts/arial.ttf':text='%DRAWTEXT_TEXT_ESC%':fontsize=60:fontcolor=white:x=w-mod(t*150\,w+text_w):y=h-60" -c:v h264_nvenc -preset slow -b:v 8000k -rc vbr -cq 18 -profile:v high -c:a aac -b:a 512k -ar 48000 -map 0:v:0 -map 1:a:0 -t !SHORT_DURATION! -movflags +faststart -shortest "%OUTPUT_VIDEO_SHORT%"
    echo =========================================================================
    REMffmpeg -y -hwaccel cuda -i "%TEMP_DIR%\looped_short.mp4" -i "%COMBINED_WAV%" -vf "drawtext=fontfile='C\:/Windows/fonts/arial.ttf':text='%DRAWTEXT_TEXT_ESC%':fontsize=60:fontcolor=white:x=w-mod(t*150\,w+text_w):y=h-60" -c:v h264_nvenc -preset slow -b:v 8000k -rc vbr -cq 18 -profile:v high -c:a aac -b:a 512k -ar 48000 -map 0:v:0 -map 1:a:0 -t !SHORT_DURATION! -movflags +faststart -shortest "%OUTPUT_VIDEO_SHORT%"
    if exist "%OUTPUT_VIDEO_SHORT%" (
        echo Created short output video: %OUTPUT_VIDEO_SHORT%
    ) else (
        echo Warning: Failed to create short output video
    )
)

REM Clean up temporary files
echo Cleaning up temporary files...
rmdir /s /q "%TEMP_DIR%"

REM Move processed WAV files to a backup directory
set BACKUP_DIR=D:\suno\processed
if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"

echo Moving processed WAV files to backup directory...
set WAV_MOVED=0
for %%f in ("%INPUT_DIR%\*.wav") do (
    if exist "%%f" (
        del "%%f"
        set /a WAV_MOVED+=1
    )
)

echo Deleted !WAV_MOVED! WAV files

echo Script completed successfully!

endlocal