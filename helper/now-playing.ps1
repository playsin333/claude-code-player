# Prints the track Windows reports as playing, one JSON line per change.
# Reads the system media sessions (the same source as the volume flyout),
# so any app that publishes there is covered: Spotify, Yandex Music,
# browsers (VK, SoundCloud, YouTube), Telegram, local players.
#
# Also presses the playback buttons: the plugin writes one word (previous,
# toggle, play, pause, next) to the command file announced in the first line,
# and the script passes it to the session it last reported.
#
# Runs under Windows PowerShell 5.1 (powershell.exe), which projects WinRT.
# Kept ASCII-only so 5.1 reads it the same way with or without a BOM.

$ErrorActionPreference = 'Stop'

function Write-Line($obj) {
    $json = $obj | ConvertTo-Json -Compress
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

# The session the last line described: the one the buttons press.
$shown = $null
$shownApp = $null

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

function Get-Track {
    $current = $manager.GetCurrentSession()
    $sessions = @($manager.GetSessions())

    # Windows' current session first, unless it is paused while another plays.
    $session = $current
    $isCurrentPlaying = $current -and $current.GetPlaybackInfo().PlaybackStatus -eq 'Playing'
    if (-not $isCurrentPlaying) {
        $playing = $sessions | Where-Object { $_.GetPlaybackInfo().PlaybackStatus -eq 'Playing' } | Select-Object -First 1
        # With everything paused, stay on the app shown last, so play resumes it.
        $same = $sessions | Where-Object { [string]$_.SourceAppUserModelId -eq $script:shownApp } | Select-Object -First 1
        if ($playing) { $session = $playing }
        elseif ($same) { $session = $same }
    }
    $script:shown = $session
    if (-not $session) { return @{ track = $null } }
    $script:shownApp = [string]$session.SourceAppUserModelId

    $properties = Await ($session.TryGetMediaPropertiesAsync()) $propertiesType
    if (-not $properties -or (-not $properties.Title -and -not $properties.Artist)) {
        return @{ track = $null }
    }

    $timeline = Get-Timeline $session
    @{
        track = @{
            app       = [string]$session.SourceAppUserModelId
            artist    = [string]$properties.Artist
            title     = [string]$properties.Title
            isPlaying = $session.GetPlaybackInfo().PlaybackStatus -eq 'Playing'
            position  = $timeline.position
            duration  = $timeline.duration
            updatedAt = $timeline.updatedAt
        }
    }
}

# The word waiting in the command file, taken out of it; $null when none.
# Moving the file takes it whole: a failed move leaves the word for the next
# look, and a word once taken is never read again, whatever fails after.
function Read-Command {
    if (-not (Test-Path -LiteralPath $commandFile)) { return $null }
    try {
        if (Test-Path -LiteralPath $takenFile) { [IO.File]::Delete($takenFile) }
        [IO.File]::Move($commandFile, $takenFile)
        $word = [IO.File]::ReadAllText($takenFile).Trim()
        if ($word -eq '') {
            # Moved while the plugin was still writing it.
            Start-Sleep -Milliseconds 50
            $word = [IO.File]::ReadAllText($takenFile).Trim()
        }
        [IO.File]::Delete($takenFile)
        $word
    }
    catch {
        $null
    }
}

# Presses a button of the shown session; true when the app accepted it.
function Send-MediaCommand([string]$word) {
    $session = $script:shown
    if (-not $session) { return $false }
    switch ($word) {
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
    $word = Read-Command
    if ($word) {
        try {
            $isDone = Send-MediaCommand $word
        }
        catch {
            $isDone = $false
        }
        Write-Line @{ command = $word; ok = $isDone }
        # Look often for a while, so the new track or state shows at once.
        $fastUntil = [DateTime]::Now.AddSeconds(2)
    }

    if ($step % 5 -eq 0 -or [DateTime]::Now -lt $fastUntil) {
        try {
            $state = Get-Track
        }
        catch {
            # A session can close between listing and reading; try again next tick.
            $state = $null
        }
        if ($state) {
            $json = $state | ConvertTo-Json -Compress
            if ($json -ne $last) {
                Write-Line $state
                $last = $json
            }
        }
    }

    $step += 1
    Start-Sleep -Milliseconds 100
}
