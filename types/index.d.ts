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

// Where the band above the prompt sits, or off.
export type TopPlace = 'off' | 'left' | 'center' | 'right'

// The band's text size.
export type TextSize = 'small' | 'normal'

// The line beside the model picker, or off.
export type BottomPlace = 'off' | 'model'

// The playback buttons and the track time.
export type Switch = 'off' | 'on'

export type PlayerSettings = {
  top: TopPlace
  size: TextSize
  bottom: BottomPlace
  controls: Switch
  time: Switch
  // Apps whose sessions the player ignores, by the id Windows gives them.
  hidden: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'now-playing': {
      // Every session the helper last reported, and the one shown of them.
      sessions: Session[]
      track: Track | null
      settings: PlayerSettings
      // The clock at the last animation tick, in ms since the epoch.
      now: number
      error: string | null
    }
  }
}
