#!/bin/zsh
# Launchd entry point for the daily SleepPiano run. launchd provides a minimal
# environment, so PATH is set explicitly: node, npx, ffmpeg and ffprobe all live
# in /opt/homebrew/bin on this machine.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

cd "${0:a:h}/.." || exit 1
mkdir -p logs

# Mjudio must be up for preflight. -g keeps it in the background and launching an
# already-running app is a no-op; when the app is missing, preflight reports it.
if open -gb com.mjudio.musicvideomaker 2>/dev/null; then
  sleep 8
else
  echo "[run_daily] Mjudio app not found — preflight will report the converter as down"
fi

# caffeinate keeps the machine from idle-sleeping while the run is in progress.
exec /usr/bin/caffeinate -i npx tsx src/setup/run_daily.ts
