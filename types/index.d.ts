export type Track = {
  app: string
  artist: string
  title: string
  isPlaying: boolean
}

// Where the band above the prompt sits, or off.
export type TopPlace = 'off' | 'left' | 'center' | 'right'

// The band's text size.
export type TextSize = 'small' | 'normal'

// The line beside the model picker, or off.
export type BottomPlace = 'off' | 'model'

export type PlayerSettings = {
  top: TopPlace
  size: TextSize
  bottom: BottomPlace
}

declare module 'claude-code' {
  interface PluginState {
    'now-playing': {
      track: Track | null
      settings: PlayerSettings
      frame: number
      error: string | null
    }
  }
}
