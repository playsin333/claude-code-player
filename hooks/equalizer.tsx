import type { ClientModule } from 'claude-code'

// No ▄: Windows draws it from another font than the rest, a frame of another width.
export const EQUALIZER = ['▂▅▃', '▅▃▇', '▃▇▂', '▇▂▅', '▃▆▂', '▆▂▃']
export const EQUALIZER_PAUSED = '▁▁▁'
export const FRAME_MS = 300

export type EqualizerProps = { isPlaying: boolean; size: 'caption' | 'body' }

// Animates on the surface's own clock, so the band around it, buttons and all,
// is not drawn again on every frame.
const Equalizer: ClientModule<EqualizerProps, number> = (props, surface) => {
  const { Text } = surface.elements
  if (surface.state === undefined) {
    surface.every(FRAME_MS, () => surface.setState(((surface.state ?? 0) + 1) % EQUALIZER.length))
    surface.setState(0)
  }
  return (
    <Text size={props.size} dimColor={!props.isPlaying} mono>
      {props.isPlaying ? (EQUALIZER[surface.state ?? 0] ?? EQUALIZER_PAUSED) : EQUALIZER_PAUSED}
    </Text>
  )
}

export default Equalizer
