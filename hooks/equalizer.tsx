import type { ClientModule } from 'claude-code'

// No ▄: Windows draws it from another font than the rest, a frame of another width.
export const EQUALIZER = ['▂▅▃', '▅▃▇', '▃▇▂', '▇▂▅', '▃▆▂', '▆▂▃']
export const EQUALIZER_PAUSED = '▁▁▁'
export const FRAME_MS = 300
// The wheel steps between neighbouring bars when the colors run around one.
export const WHEEL_SPREAD = 8

// `colors`: none, the text's own; three, one per bar; more, a wheel the bars
// run around.
export type EqualizerProps = { isPlaying: boolean; size: 'caption' | 'body'; colors: string[] }

type EqualizerState = { frame: number; turn: number }

const WHEEL_MS = 100

// The color of bar `index`, its turn round the wheel at `turn`.
export const barColor = (colors: readonly string[], index: number, turn: number): string | undefined =>
  colors.length <= 3 ? colors[index] : colors[(turn + index * WHEEL_SPREAD) % colors.length]

// Remembers each instance's latest props for its timers, which run on.
const latest = new WeakMap<object, EqualizerProps>()

// Runs on the surface's own clock, so the band around it, buttons and all, is
// not drawn again on every frame: plays its frames while the track plays, and
// turns a color wheel when it has one.
const Equalizer: ClientModule<EqualizerProps, EqualizerState> = (props, surface) => {
  const { Text } = surface.elements
  latest.set(surface, props)
  if (surface.state === undefined) {
    surface.every(FRAME_MS, () => {
      const state = surface.state
      if (state !== undefined && latest.get(surface)?.isPlaying === true) {
        surface.setState({ ...state, frame: (state.frame + 1) % EQUALIZER.length })
      }
    })
    surface.every(WHEEL_MS, () => {
      const [state, current] = [surface.state, latest.get(surface)]
      if (state !== undefined && current?.isPlaying === true && current.colors.length > 3) {
        surface.setState({ ...state, turn: state.turn + 1 })
      }
    })
    surface.setState({ frame: 0, turn: 0 })
  }

  const { frame = 0, turn = 0 } = surface.state ?? {}
  const glyphs = props.isPlaying ? (EQUALIZER[frame] ?? EQUALIZER_PAUSED) : EQUALIZER_PAUSED
  if (!props.isPlaying || props.colors.length === 0) {
    return (
      <Text size={props.size} dimColor={!props.isPlaying} mono>
        {glyphs}
      </Text>
    )
  }
  return (
    <Text size={props.size} mono>
      {[...glyphs].map((glyph, index) => {
        const color = barColor(props.colors, index, turn)
        return color === undefined ? <Text>{glyph}</Text> : <Text color={color}>{glyph}</Text>
      })}
    </Text>
  )
}

export default Equalizer
