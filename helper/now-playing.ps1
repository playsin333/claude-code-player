# Prints the track Windows reports as playing, one JSON line per change.
# Reads the system media sessions (the same source as the volume flyout),
# so any app that publishes there is covered: Spotify, Yandex Music,
# browsers (VK, SoundCloud, YouTube), Telegram, local players.
#
# Also reads how loud the sound is, ten times a second, for the equalizer.
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

    # Waits for a WinRT operation, at most $timeoutMs: an app that never
    # answers costs its own session, not the whole player.
    function Await($operation, [Type]$resultType, [int]$timeoutMs = 3000) {
        $task = $asTaskGeneric.MakeGenericMethod($resultType).Invoke($null, @($operation))
        if (-not $task.Wait($timeoutMs)) { throw "no answer in $timeoutMs ms" }
        $task.Result
    }

    $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
    $managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
    $propertiesType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
    $manager = Await ($managerType::RequestAsync()) $managerType 15000
}
catch {
    Write-Line @{ error = "media sessions unavailable: $($_.Exception.Message)" }
    exit 1
}

# The default output device's peak meter, the one the volume mixer shows:
# how loud the sound is now, for the equalizer. Optional: without it the
# equalizer plays its own frames.
$meterSource = @'
using System;
using System.Runtime.InteropServices;

namespace NowPlaying
{
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    internal class DeviceEnumerator
    {
    }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IMMDeviceEnumerator
    {
        [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
        [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IMMDevice
    {
        [PreserveSig] int Activate(ref Guid iid, int context, IntPtr parameters, [MarshalAs(UnmanagedType.IUnknown)] out object face);
    }

    [ComImport, Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IAudioMeterInformation
    {
        [PreserveSig] int GetPeakValue(out float peak);
        [PreserveSig] int GetMeteringChannelCount(out int count);
        [PreserveSig] int GetChannelsPeakValues(int count, [In, Out, MarshalAs(UnmanagedType.LPArray, SizeParamIndex = 0)] float[] peaks);
    }

    // Peaks of the sound playing now, 0 to 1: overall, left, right.
    public static class Meter
    {
        private static IAudioMeterInformation meter;
        private static DateTime openedAt = DateTime.MinValue;

        public static float[] Read()
        {
            // The default device changes (headphones in): open it again now and then.
            if (meter == null || (DateTime.UtcNow - openedAt).TotalSeconds > 5)
            {
                meter = Open();
                openedAt = DateTime.UtcNow;
            }
            try
            {
                float peak;
                int count;
                Marshal.ThrowExceptionForHR(meter.GetPeakValue(out peak));
                Marshal.ThrowExceptionForHR(meter.GetMeteringChannelCount(out count));
                float[] channels = new float[Math.Max(count, 1)];
                if (count > 0) Marshal.ThrowExceptionForHR(meter.GetChannelsPeakValues(count, channels));
                return new float[] { peak, channels[0], count > 1 ? channels[1] : channels[0] };
            }
            catch
            {
                meter = null;
                throw;
            }
        }

        private static IAudioMeterInformation Open()
        {
            IMMDeviceEnumerator devices = (IMMDeviceEnumerator)new DeviceEnumerator();
            IMMDevice device;
            // Rendering (0), the multimedia role (1).
            Marshal.ThrowExceptionForHR(devices.GetDefaultAudioEndpoint(0, 1, out device));
            Guid iid = typeof(IAudioMeterInformation).GUID;
            object face;
            // CLSCTX_ALL.
            Marshal.ThrowExceptionForHR(device.Activate(ref iid, 23, IntPtr.Zero, out face));
            return (IAudioMeterInformation)face;
        }
    }
}
'@
$hasMeter = $false
try {
    Add-Type -TypeDefinition $meterSource -Language CSharp
    $hasMeter = $true
}
catch {
}

# The meter's peaks, rounded; $null without a meter or when it fails to read.
function Get-Levels {
    if (-not $hasMeter) { return $null }
    try {
        , @([NowPlaying.Meter]::Read() | ForEach-Object { [math]::Round([double]$_, 2) })
    }
    catch {
        $null
    }
}

# One file per running script, so two Claude sessions never share a press.
$commandFile = Join-Path ([IO.Path]::GetTempPath()) "now-playing-$PID.cmd"
$takenFile = "$commandFile.taken"
foreach ($file in @($commandFile, $takenFile)) {
    if (Test-Path -LiteralPath $file) { [IO.File]::Delete($file) }
}
Write-Line @{ commands = $commandFile }

# The Claude process that started the script: when it is gone, so is the
# script, even after a crash that killed no children. $null when unknown.
$parentId = $null
try {
    $parentId = (Get-CimInstance Win32_Process -Filter "ProcessId = $PID").ParentProcessId
}
catch {
}

function Test-ParentGone {
    if (-not $parentId) { return $false }
    -not (Get-Process -Id $parentId -ErrorAction SilentlyContinue)
}

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
$lastLevels = $null
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

    # Ten readings a second while they change, and one a second anyway, so
    # silence reads as silence and not as a meter gone quiet.
    $levels = Get-Levels
    if ($levels) {
        $text = $levels -join ' '
        if ($text -ne $lastLevels -or $step % 10 -eq 0) {
            Write-Line @{ levels = $levels }
            $lastLevels = $text
        }
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

    # Every ten seconds or so.
    if ($step % 100 -eq 99 -and (Test-ParentGone)) { exit 0 }

    $step += 1
    Start-Sleep -Milliseconds 100
}
