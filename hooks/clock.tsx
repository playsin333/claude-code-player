import type { ClientModule } from 'claude-code'

export const CLOCK_MS = 500

export type ClockProps = { time: string; size: 'caption' | 'body' }

// Shows the track time, asking the hooks module for it twice a second: its
// answer comes back as the next props, and the band around it is not drawn again.
const Clock: ClientModule<ClockProps, true> = (props, surface) => {
  const { Text } = surface.elements
  if (surface.state === undefined) {
    surface.every(CLOCK_MS, () => surface.post('time'))
    surface.setState(true)
  }
  return (
    <Text size={props.size} dimColor tabular>
      {props.time}
    </Text>
  )
}

export default Clock
