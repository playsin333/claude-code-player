export type Track = {
  app: string
  artist: string
  title: string
  isPlaying: boolean
}

// Which players show: above the prompt, in the status line, both, or none.
export type Mode = 'bar' | 'line' | 'both' | 'off'

declare module 'claude-code' {
  interface PluginState {
    'now-playing': {
      track: Track | null
      mode: Mode
      frame: number
      error: string | null
    }
  }
}
