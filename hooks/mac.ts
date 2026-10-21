// macOS, experimental: since macOS 15.4 only Apple's own apps may read what
// plays system-wide, so the player asks Spotify and Music themselves, through
// osascript and their scripting. Browsers are out of its reach there.

import type { Session } from '../types'

export const MAC_APPS = ['Spotify', 'Music'] as const
type MacApp = (typeof MAC_APPS)[number]

// The scripting command each button sends; both apps name them alike.
const MAC_METHODS = {
  previous: 'previousTrack',
  toggle: 'playpause',
  play: 'play',
  pause: 'pause',
  next: 'nextTrack',
} as const

// Reads the apps that run, as JSON. `running()` does not start an app that is
// not running; Spotify gives a track's length in milliseconds, Music in seconds.
const READ = `(() => {
  const found = []
  for (const name of ${JSON.stringify(MAC_APPS)}) {
    let app
    try { app = Application(name) } catch (error) { continue }
    if (!app.running()) continue
    const state = app.playerState()
    if (state !== 'playing' && state !== 'paused') continue
    const track = app.currentTrack
    const duration = Number(track.duration())
    found.push({
      app: name,
      artist: String(track.artist()),
      title: String(track.name()),
      isPlaying: state === 'playing',
      position: Number(app.playerPosition()),
      duration: name === 'Spotify' ? duration / 1000 : duration,
    })
  }
  return JSON.stringify(found)
})()`

export const readArgv = (): string[] => ['osascript', '-l', 'JavaScript', '-e', READ]

const isMacApp = (app: string): app is MacApp => (MAC_APPS as readonly string[]).includes(app)

// The press as a script for that app; undefined for an app it does not script.
export const pressArgv = (app: string, command: keyof typeof MAC_METHODS): string[] | undefined =>
  isMacApp(app) ? ['osascript', '-l', 'JavaScript', '-e', `Application(${JSON.stringify(app)}).${MAC_METHODS[command]}()`] : undefined

// The sessions in what the read printed, as of `at`.
export const macSessions = (stdout: string, at: number): Session[] => {
  const found = JSON.parse(stdout) as unknown
  if (!Array.isArray(found)) return []
  return found.flatMap((one: Record<string, unknown>) => {
    const app = String(one.app ?? '')
    if (!isMacApp(app) || typeof one.title !== 'string') return []
    const position = Number(one.position)
    const duration = Number(one.duration)
    return [
      {
        app,
        artist: typeof one.artist === 'string' ? one.artist : '',
        title: one.title,
        isPlaying: one.isPlaying === true,
        isCurrent: false,
        position: Number.isFinite(position) ? position : 0,
        duration: Number.isFinite(duration) ? duration : 0,
        updatedAt: Number.isFinite(position) ? at : 0,
      },
    ]
  })
}
