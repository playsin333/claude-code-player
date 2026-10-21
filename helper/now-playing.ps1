# Prints the track Windows reports as playing, one JSON line per change.
# Reads the system media sessions (the same source as the volume flyout),
# so any app that publishes there is covered: Spotify, Yandex Music,
# browsers (VK, SoundCloud, YouTube), Telegram, local players.
#
# Also presses the playback buttons: the plugin writes a press as JSON, the
# button (previous, toggle, play, pause, next) and the app it is for, to the
# command file announced in the first line, and the script passes it on.
#
# Runs under Windows PowerShell 5.1 (powershell.exe), which projects WinRT.
# Kept ASCII-only so 5.1 reads it the same way with or without a BOM.

$ErrorActionPreference = 'Stop'

function Write-Line($obj) {
    $json = $obj | ConvertTo-Json -Compress -Depth 5
    # Escape everything outside ASCII so the console code page cannot garble it.
    $json = [regex]::Replace($json, '[^\x00-\x7F]', { param($m) '\u{0:x4}' -f [int][char]$m.Value })
    [Console]::Out.WriteLine($json)
    [Console]::Out.Flush()
}

try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $asTaskGeneric = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
        $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    } | Select-Object -First 1

    function Await($operation, [Type]$resultType) {
        $task = $asTaskGeneric.MakeGenericMethod($resultType).Invoke($null, @($operation))
        $task.Wait(-1) | Out-Null
        $task.Result
    }

    $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
    $managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
    $propertiesType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
    $manager = Await ($managerType::RequestAsync()) $managerType
}
catch {
    Write-Line @{ error = "media sessions unavailable: $($_.Exception.Message)" }
    exit 1
}

# One file per running script, so two Claude sessions never share a press.
$commandFile = Join-Path ([IO.Path]::GetTempPath()) "now-playing-$PID.cmd"
$takenFile = "$commandFile.taken"
foreach ($file in @($commandFile, $takenFile)) {
    if (Test-Path -LiteralPath $file) { [IO.File]::Delete($file) }
}
Write-Line @{ commands = $commandFile }

function Get-Timeline($session) {
    try {
        $timeline = $session.GetTimelineProperties()
        @{
            position  = [math]::Round(($timeline.Position - $timeline.StartTime).TotalSeconds, 1)
            duration  = [math]::Round(($timeline.EndTime - $timeline.StartTime).TotalSeconds, 1)
            updatedAt = $timeline.LastUpdatedTime.ToUnixTimeMilliseconds()
        }
    }
    catch {
        @{ position = 0; duration = 0; updatedAt = 0 }
    }
}

# Every session with a track to show, and which one Windows calls current.
# The plugin picks the one to show; this only reports.
function Get-Sessions {
    $current = $manager.GetCurrentSession()
    $currentApp = if ($current) { [string]$current.SourceAppUserModelId } else { $null }
    $list = @()
    foreach ($session in @($manager.GetSessions())) {
        try {
            $properties = Await ($session.TryGetMediaPropertiesAsync()) $propertiesType
            if (-not $properties -or (-not $properties.Title -and -not $properties.Artist)) { continue }
            $app = [string]$session.SourceAppUserModelId
            $timeline = Get-Timeline $session
            $list += @{
                app       = $app
                artist    = [string]$properties.Artist
                title     = [string]$properties.Title
                isPlaying = $session.GetPlaybackInfo().PlaybackStatus -eq 'Playing'
                isCurrent = $app -eq $currentApp
                position  = $timeline.position
                duration  = $timeline.duration
                updatedAt = $timeline.updatedAt
            }
        }
        catch {
            # A session can close between listing and reading; it is left out.
        }
    }
    @{ sessions = $list }
}

# The session a press is for: the app's, the one with that title if the app
# has several.
function Find-Session([string]$app, [string]$title) {
    $matching = @($manager.GetSessions() | Where-Object { [string]$_.SourceAppUserModelId -eq $app })
    if ($matching.Count -gt 1) {
        foreach ($session in $matching) {
            try {
                $properties = Await ($session.TryGetMediaPropertiesAsync()) $propertiesType
                if ([string]$properties.Title -eq $title) { return $session }
            }
            catch {
            }
        }
    }
    $matching | Select-Object -First 1
}

# The press waiting in the command file, taken out of it; $null when none.
# Moving the file takes it whole: a failed move leaves the press for the next
# look, and a press once taken is never read again, whatever fails after.
function Read-Command {
    if (-not (Test-Path -LiteralPath $commandFile)) { return $null }
    try {
        if (Test-Path -LiteralPath $takenFile) { [IO.File]::Delete($takenFile) }
        [IO.File]::Move($commandFile, $takenFile)
        $text = [IO.File]::ReadAllText($takenFile).Trim()
        if ($text -eq '') {
            # Moved while the plugin was still writing it.
            Start-Sleep -Milliseconds 50
            $text = [IO.File]::ReadAllText($takenFile).Trim()
        }
        [IO.File]::Delete($takenFile)
        $text
    }
    catch {
        $null
    }
}

# Presses a button of the session the plugin named; true when the app accepted it.
function Send-MediaCommand($order) {
    $session = Find-Session ([string]$order.app) ([string]$order.title)
    if (-not $session) { return $false }
    switch ([string]$order.command) {
        'previous' { return [bool](Await ($session.TrySkipPreviousAsync()) ([bool])) }
        'toggle' { return [bool](Await ($session.TryTogglePlayPauseAsync()) ([bool])) }
        'play' { return [bool](Await ($session.TryPlayAsync()) ([bool])) }
        'pause' { return [bool](Await ($session.TryPauseAsync()) ([bool])) }
        'next' { return [bool](Await ($session.TrySkipNextAsync()) ([bool])) }
    }
    $false
}

$last = $null
$step = 0
$fastUntil = [DateTime]::MinValue
while ($true) {
    $text = Read-Command
    if ($text) {
        $order = $null
        try {
            # {"command": "next", "app": "Spotify.exe", "title": "..."}
            $order = $text | ConvertFrom-Json
            $isDone = Send-MediaCommand $order
        }
        catch {
            $isDone = $false
        }
        Write-Line @{ command = [string]$order.command; app = [string]$order.app; ok = $isDone }
        # Look often for a while, so the new track or state shows at once.
        $fastUntil = [DateTime]::Now.AddSeconds(2)
    }

    if ($step % 5 -eq 0 -or [DateTime]::Now -lt $fastUntil) {
        try {
            $state = Get-Sessions
        }
        catch {
            # The session list itself failed; try again next tick.
            $state = $null
        }
        if ($state) {
            $json = $state | ConvertTo-Json -Compress -Depth 5
            if ($json -ne $last) {
                Write-Line $state
                $last = $json
            }
        }
    }

    $step += 1
    Start-Sleep -Milliseconds 100
}
