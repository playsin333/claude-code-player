export type Track = {
  app: string
  artist: string
  title: string
  isPlaying: boolean
  // Seconds into the track at `updatedAt`, and its length; 0 when the app
  // reports no timeline.
  position?: number
  duration?: number
  // When the app last reported the position, in ms since the epoch.
  updatedAt?: number
}

// A media session as the helper reports it: its track, and whether Windows
// calls it the current one.
export type Session = Track & { isCurrent: boolean }

// An app in the panel's sources, with what it plays.
export type Source = { app: string; text: string }

// One line of synced lyrics: when it starts, in seconds, and its words.
export type LyricLine = { at: number; text: string }

// The lyrics looked up for the shown track, by its artist and title.
export type FoundLyrics = {
  key: string
  status: 'searching' | 'found' | 'missing' | 'failed'
  lines: LyricLine[]
  // Why the search failed, for /player debug.
  detail?: string
}

// Where the band above the prompt sits, or off.
export type TopPlace = 'off' | 'left' | 'center' | 'right'

// The band's text size.
export type TextSize = 'small' | 'normal'

// The line beside the model picker, or off.
export type BottomPlace = 'off' | 'model'

// The playback buttons and the track time.
export type Switch = 'off' | 'on'

// The colors of the equalizer and of the word being sung: none, a fixed set,
// a running rainbow, or shades of the person's own `color`.
export type Palette = 'mono' | 'claude' | 'neon' | 'sunset' | 'rgb' | 'custom'

// The equalizer: its own frames, or live, from how loud the sound is (Windows).
export type EqualizerMode = 'frames' | 'live'

export type PlayerSettings = {
  top: TopPlace
  size: TextSize
  bottom: BottomPlace
  controls: Switch
  time: Switch
  // Synced lyrics from lrclib.net in place of the title; off until asked for,
  // since the search sends the artist and title there.
  lyrics: Switch
  palette: Palette
  equalizer: EqualizerMode
  // The `custom` palette's color, #rrggbb.
  color: string
  // Apps whose sessions the player ignores, by the id Windows gives them.
  hidden: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'now-playing': {
      // Every session the helper last reported, and the one shown of them.
      // `track` changes only when what it shows does: another track or state,
      // or a time a second or two off where it counts on to.
      sessions: Session[]
      track: Track | null
      // The apps the sessions come from, changed only when one comes or goes
      // or plays something else.
      sources: Source[]
      lyrics: FoundLyrics | null
      settings: PlayerSettings
      // The clock at the last animation tick, in ms since the epoch.
      now: number
      error: string | null
    }
  }
}
