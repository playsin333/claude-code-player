import type { ClientModule } from 'claude-code'

import type { LyricLine } from '../types'

export type LyricsProps = {
  lines: LyricLine[]
  // Seconds into the track when these props were made.
  position: number
  isPlaying: boolean
  // What shows before the first line and in breaks.
  title: string
  size: 'caption' | 'body'
  // New with every props, so the count starts over from `position`.
  stamp: number
}

type LyricsState = { stamp: number; ms: number }

// A word in view: its text, trailing space included, and how long it has been in view.
export type ShownWord = { text: string; age: number }

const TICK_MS = 50
const ASK_MS = 1000
// A word comes in dim and turns bright after this long.
const FADE_S = 0.2
// How long a line takes to sing at most, per character: a slow song's line
// is not spread over the whole pause after it.
const SECONDS_PER_CHAR = 0.11
// The share of the time before the next line its words may take.
const LINE_SHARE = 0.85
// A last line, or one followed by a long pause, stays this long once sung.
const HOLD_S = 6

// Reads LRC text: `[mm:ss.xx] words` lines, several stamps on one line allowed,
// other tags skipped. Sorted by time.
export const parseLrc = (lrc: string): LyricLine[] => {
  const lines: LyricLine[] = []
  for (const raw of lrc.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:[.:]\d+)?)\]/g)]
    if (stamps.length === 0) continue
    const text = raw.replace(/\[[^\]]*\]/g, '').trim()
    for (const [, minutes, seconds] of stamps) {
      lines.push({ at: Number(minutes) * 60 + Number(String(seconds).replace(':', '.')), text })
    }
  }
  return lines.sort((a, b) => a.at - b.at)
}

// The words of the line being sung at `at`, each in view from the moment it is
// sung: a line's words share its singing time by their length. Undefined
// before the first line, in a break, and long after a line ends.
export const reveal = (lines: readonly LyricLine[], at: number): ShownWord[] | undefined => {
  const index = lines.findLastIndex(line => line.at <= at)
  const line = lines[index]
  if (line === undefined || line.text === '') return undefined
  const next = lines[index + 1]?.at ?? Infinity
  const length = line.text.length
  const singing = Math.min((next - line.at) * LINE_SHARE, length * SECONDS_PER_CHAR)
  if (at > line.at + singing + HOLD_S) return undefined

  let before = 0
  const words: ShownWord[] = []
  for (const text of line.text.match(/\S+\s*/g) ?? []) {
    const age = at - (line.at + (singing * before) / length)
    before += text.length
    if (age < 0) break
    words.push({ text, age })
  }
  return words
}

export const isFresh = (word: ShownWord): boolean => word.age < FADE_S

// Remembers each instance's latest props for its timer, which runs on.
const latest = new WeakMap<object, LyricsProps>()

// Sings along: counts the time on from the props' `position` on the surface's
// own clock, and asks the hooks module for the position once a second.
const Lyrics: ClientModule<LyricsProps, LyricsState> = (props, surface) => {
  const { Text } = surface.elements
  latest.set(surface, props)
  if (surface.state === undefined) {
    surface.every(TICK_MS, () => {
      const current = latest.get(surface)
      const state = surface.state
      if (current === undefined || state === undefined) return
      if (state.stamp !== current.stamp) surface.setState({ stamp: current.stamp, ms: 0 })
      else if (current.isPlaying) surface.setState({ stamp: state.stamp, ms: state.ms + TICK_MS })
    })
    surface.every(ASK_MS, () => surface.post('lyrics'))
    surface.setState({ stamp: props.stamp, ms: 0 })
  }

  const ms = surface.state?.stamp === props.stamp ? surface.state.ms : 0
  const words = reveal(props.lines, props.position + ms / 1000)
  if (words === undefined) {
    return (
      <Text size={props.size} dimColor={!props.isPlaying} wrap="truncate-end">
        {props.title}
      </Text>
    )
  }
  // A line longer than the room keeps its newest words in view.
  return (
    <Text size={props.size} dimColor={!props.isPlaying} wrap="truncate-start">
      {words.map(word => (
        <Text dimColor={isFresh(word)}>{word.text}</Text>
      ))}
    </Text>
  )
}

export default Lyrics
