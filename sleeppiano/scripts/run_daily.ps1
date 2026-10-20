# Task Scheduler entry point for the daily SleepPiano run -- the Windows sibling of
# run_daily.sh. Task Scheduler starts a task with a minimal environment and an
# arbitrary working directory, so the working directory is set explicitly here.
#
# Register it with:
#   schtasks /Create /TN "SleepPiano daily" /SC DAILY /ST 02:00 /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'C:\path\to\auto-eliza-m\sleeppiano\scripts\run_daily.ps1'"
$ErrorActionPreference = 'Stop'

Set-Location (Join-Path $PSScriptRoot '..')
New-Item -ItemType Directory -Force -Path 'logs' | Out-Null

# Mjudio must be up for preflight, with Settings > Automation enabled; otherwise a run
# can burn two hours of Suno credits and only then find the converter was never running.
# Starting an already-running instance would open a second window, so check first.
$mjudio = Join-Path $env:LOCALAPPDATA 'Programs\Mjudio\Mjudio.UI.exe'
if (-not (Get-Process -Name 'Mjudio.UI' -ErrorAction SilentlyContinue)) {
    if (Test-Path $mjudio) {
        Start-Process -FilePath $mjudio -WindowStyle Minimized
        Start-Sleep -Seconds 8
    } else {
        Write-Host "[run_daily] Mjudio not found at $mjudio - preflight will report the converter as down"
    }
}

# The counterpart of macOS caffeinate: keep the machine from idle-sleeping mid-run.
# ES_CONTINUOUS (0x80000000) or ES_SYSTEM_REQUIRED (0x00000001); ES_CONTINUOUS on its
# own in the finally block clears the request again.
Add-Type -Name Power -Namespace Win32 -MemberDefinition @'
[DllImport("kernel32.dll", SetLastError = true)]
public static extern uint SetThreadExecutionState(uint esFlags);
'@
[void][Win32.Power]::SetThreadExecutionState(0x80000000 -bor 0x00000001)

$exitCode = 0
try {
    & npx tsx src/setup/run_daily.ts
    $exitCode = $LASTEXITCODE
} finally {
    [void][Win32.Power]::SetThreadExecutionState(0x80000000)
}
exit $exitCode
