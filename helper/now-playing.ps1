# Prints the track Windows reports as playing, one JSON line per change.
# Reads the system media sessions (the same source as the volume flyout),
# so any app that publishes there is covered: Spotify, Yandex Music,
# browsers (VK, SoundCloud, YouTube), Telegram, local players.
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

function Get-Track {
    $current = $manager.GetCurrentSession()
    $sessions = @($manager.GetSessions())

    # Windows' current session first, unless it is paused while another plays.
    $session = $current
    $isCurrentPlaying = $current -and $current.GetPlaybackInfo().PlaybackStatus -eq 'Playing'
    if (-not $isCurrentPlaying) {
        $playing = $sessions | Where-Object { $_.GetPlaybackInfo().PlaybackStatus -eq 'Playing' } | Select-Object -First 1
        if ($playing) { $session = $playing }
    }
    if (-not $session) { return @{ track = $null } }

    $properties = Await ($session.TryGetMediaPropertiesAsync()) $propertiesType
    if (-not $properties -or (-not $properties.Title -and -not $properties.Artist)) {
        return @{ track = $null }
    }

    @{
        track = @{
            app       = [string]$session.SourceAppUserModelId
            artist    = [string]$properties.Artist
            title     = [string]$properties.Title
            isPlaying = $session.GetPlaybackInfo().PlaybackStatus -eq 'Playing'
        }
    }
}

$last = $null
while ($true) {
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
    Start-Sleep -Milliseconds 500
}
