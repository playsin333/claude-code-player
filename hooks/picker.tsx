import type { ClientModule } from 'claude-code'

// `hues`: the top strip, a cell each; `shades`: the bottom strip, spread over
// the same width. The hooks module makes both, so a click names a color of its.
export type PickerProps = { hues: string[]; shades: string[] }

// What a click posts: which strip, and which of its colors.
export type PickerClick = { strip: 'hue' | 'shade'; index: number }

// Remembers each instance's latest props for its pointer listener.
const latest = new WeakMap<object, PickerProps>()

// Two strips to click a color on, like a paint program's: every hue on top,
// the chosen hue from dark to light below.
const Picker: ClientModule<PickerProps, true> = (props, surface) => {
  const { Box, Text } = surface.elements
  latest.set(surface, props)
  if (surface.state === undefined) {
    surface.onPointer(event => {
      const current = latest.get(surface)
      if (event.type !== 'down' || current === undefined || event.x < 0) return
      const strip = event.y === 0 ? current.hues : event.y === 1 ? current.shades : undefined
      if (strip === undefined || strip.length === 0) return
      const width = surface.columns > 0 ? surface.columns : current.hues.length
      const index = Math.floor((event.x * strip.length) / width)
      if (index >= strip.length) return
      const click: PickerClick = { strip: event.y === 0 ? 'hue' : 'shade', index }
      surface.post(click)
    })
    surface.setState(true)
  }

  const cells = Math.max(1, Math.floor(props.hues.length / Math.max(1, props.shades.length)))
  return (
    <Box flexDirection="column">
      <Text mono>
        {props.hues.map(color => (
          <Text color={color}>█</Text>
        ))}
      </Text>
      <Text mono>
        {props.shades.map(color => (
          <Text color={color}>{'█'.repeat(cells)}</Text>
        ))}
      </Text>
    </Box>
  )
}

export default Picker
