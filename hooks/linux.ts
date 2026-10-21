// Linux: the players that speak MPRIS on the session bus (Spotify, browsers,
// VLC and most others), asked through busctl, which comes with systemd.

import type { Session } from '../types'

export const MPRIS = 'org.mpris.MediaPlayer2.'
const MPRIS_PATH = '/org/mpris/MediaPlayer2'
const MPRIS_PLAYER = 'org.mpris.MediaPlayer2.Player'

// The player method each button calls.
export const MPRIS_METHODS = {
  previous: 'Previous',
  toggle: 'PlayPause',
  play: 'Play',
  pause: 'Pause',
  next: 'Next',
} as const

// A value as `busctl --json=short` prints it.
type BusValue = { type?: unknown; data?: unknown }

const BUSCTL = ['busctl', '--user', '--json=short'] as const

export const listNamesArgv = (): string[] => [
  ...BUSCTL,
  'call',
  'org.freedesktop.DBus',
  '/org/freedesktop/DBus',
  'org.freedesktop.DBus',
  'ListNames',
]

// One call for all three: a player that keeps no position fails it, yet
// prints the status and metadata before the failure.
export const playerArgv = (name: string): string[] => [
  ...BUSCTL,
  'get-property',
  name,
  MPRIS_PATH,
  MPRIS_PLAYER,
  'PlaybackStatus',
  'Metadata',
  'Position',
]

export const pressArgv = (app: string, command: keyof typeof MPRIS_METHODS): string[] => [
  ...BUSCTL,
  'call',
  `${MPRIS}${app}`,
  MPRIS_PATH,
  MPRIS_PLAYER,
  MPRIS_METHODS[command],
]

// The MPRIS players among the names ListNames printed.
export const playerNames = (stdout: string): string[] => {
  const { data } = JSON.parse(stdout) as BusValue
  const names = Array.isArray(data) && Array.isArray(data[0]) ? (data[0] as unknown[]) : []
  return names.filter((name): name is string => typeof name === 'string' && name.startsWith(MPRIS))
}

const field = (fields: Record<string, BusValue>, key: string): unknown => fields[key]?.data

// A player's session from what get-property printed, read at `at`; undefined
// for a stopped player or one with nothing to show.
export const mprisSession = (name: string, stdout: string, at: number): Session | undefined => {
  const [status, metadata, position] = stdout
    .split('\n')
    .filter(line => line.trim() !== '')
    .map(line => JSON.parse(line) as BusValue)
  if (status?.type !== 's' || metadata?.type !== 'a{sv}' || status.data === 'Stopped') return undefined

  const fields = (metadata.data ?? {}) as Record<string, BusValue>
  const title = field(fields, 'xesam:title')
  const artist = field(fields, 'xesam:artist')
  const artists = Array.isArray(artist) ? artist.filter(one => typeof one === 'string') : typeof artist === 'string' ? [artist] : []
  const length = Number(field(fields, 'mpris:length') ?? 0)
  if ((typeof title !== 'string' || title === '') && artists.length === 0) return undefined

  // A position is in microseconds, as of the moment it was read.
  const isTimed = position?.type === 'x' || position?.type === 't'
  return {
    app: name.slice(MPRIS.length),
    artist: artists.join(', '),
    title: typeof title === 'string' ? title : '',
    isPlaying: status.data === 'Playing',
    isCurrent: false,
    duration: Number.isFinite(length) && length > 0 ? length / 1_000_000 : 0,
    position: isTimed ? Number(position.data) / 1_000_000 : 0,
    updatedAt: isTimed ? at : 0,
  }
}
