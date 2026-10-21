import type { ClientModule } from 'claude-code'

// No ▄: Windows draws it from another font than the rest, a frame of another width.
export const EQUALIZER = ['▂▅▃', '▅▃▇', '▃▇▂', '▇▂▅', '▃▆▂', '▆▂▃']
export const EQUALIZER_PAUSED = '▁▁▁'
export const FRAME_MS = 300

// `bars`: the live bars, from how loud the sound is now; absent, the
// equalizer plays its own frames.
export type EqualizerProps = { isPlaying: boolean; size: 'caption' | 'body'; bars?: string }

const LEVEL_MS = 100

// Remembers each instance's latest props for its timers, which run on.
const latest = new WeakMap<object, EqualizerProps>()

// Runs on the surface's own clock, so the band around it, buttons and all, is
// not drawn again on every frame: asks the hooks module for the live bars ten
// times a second while the track plays, and plays its own frames without them.
const Equalizer: ClientModule<EqualizerProps, number> = (props, surface) => {
  const { Text } = surface.elements
  latest.set(surface, props)
  if (surface.state === undefined) {
    surface.every(FRAME_MS, () => {
      if (latest.get(surface)?.bars === undefined) surface.setState(((surface.state ?? 0) + 1) % EQUALIZER.length)
    })
    surface.every(LEVEL_MS, () => {
      if (latest.get(surface)?.isPlaying === true) surface.post('level')
    })
    surface.setState(0)
  }
  return (
    <Text size={props.size} dimColor={!props.isPlaying} mono>
      {props.isPlaying ? (props.bars ?? EQUALIZER[surface.state ?? 0] ?? EQUALIZER_PAUSED) : EQUALIZER_PAUSED}
    </Text>
  )
}

export default Equalizer
