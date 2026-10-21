import type { Palette } from '../types'

// A color by hue (0 to 360), saturation and lightness (0 to 1).
type Hsl = { h: number; s: number; l: number }

// What a palette paints: the equalizer's bars, one color each, or a wheel
// they run around when there are more than three; the word being sung, the
// next of `accents` for each word. Empty: the text's own color.
export type Colors = { bars: string[]; accents: string[] }

export const PICKER_HUES = 36
export const PICKER_SHADES = 12

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value))

// #rgb or #rrggbb, with or without the #, as #rrggbb; undefined for anything else.
export const parseHex = (text: string): string | undefined => {
  const short = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(text)
  if (short !== null) return `#${short.slice(1).map(digit => digit.repeat(2)).join('')}`.toLowerCase()
  const long = /^#?([0-9a-f]{6})$/i.exec(text)
  return long?.[1] === undefined ? undefined : `#${long[1]}`.toLowerCase()
}

export const toHsl = (hex: string): Hsl => {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16) / 255)
  const [high, low] = [Math.max(r, g, b), Math.min(r, g, b)]
  const l = (high + low) / 2
  if (high === low) return { h: 0, s: 0, l }
  const span = high - low
  const s = l > 0.5 ? span / (2 - high - low) : span / (high + low)
  const h = high === r ? (g - b) / span + (g < b ? 6 : 0) : high === g ? (b - r) / span + 2 : (r - g) / span + 4
  return { h: h * 60, s, l }
}

export const toHex = ({ h, s, l }: Hsl): string => {
  const reach = s * Math.min(l, 1 - l)
  const channel = (n: number): number => {
    const k = (n + h / 30) % 12
    return l - reach * Math.max(-1, Math.min(k - 3, 9 - k, 1))
  }
  return `#${[channel(0), channel(8), channel(4)].map(value => Math.round(value * 255).toString(16).padStart(2, '0')).join('')}`
}

// The rainbow `rgb` runs around, ten degrees a step.
const WHEEL = Array.from({ length: 36 }, (_, step) => toHex({ h: step * 10, s: 0.85, l: 0.62 }))

const FIXED: Record<'claude' | 'neon' | 'sunset', Colors> = {
  claude: { bars: ['#eb9473', '#d97757', '#bf5f3d'], accents: ['#d97757'] },
  neon: { bars: ['#ff5fd2', '#a178ff', '#3ddcff'], accents: ['#3ddcff'] },
  sunset: { bars: ['#ffd166', '#ff8c42', '#ff4d6d'], accents: ['#ff8c42'] },
}

// Three bars from one color: a shade lighter, the color, a shade darker.
const shadesOf = (hex: string): string[] => {
  const color = toHsl(hex)
  return [toHex({ ...color, l: clamp(color.l + 0.12, 0, 0.92) }), hex, toHex({ ...color, l: clamp(color.l - 0.12, 0.08, 1) })]
}

export const paletteColors = (palette: Palette, custom: string): Colors =>
  palette === 'mono'
    ? { bars: [], accents: [] }
    : palette === 'rgb'
      ? { bars: WHEEL, accents: WHEEL.filter((_, step) => step % 3 === 0) }
      : palette === 'custom'
        ? { bars: shadesOf(custom), accents: [custom] }
        : FIXED[palette]

// Three colors that show a palette in a glance, for its button.
export const paletteSample = (palette: Palette, custom: string): string[] => {
  const { bars } = paletteColors(palette, custom)
  return bars.length > 3 ? [0, 12, 24].map(step => bars[step] ?? '') : bars
}

// The picker's top strip: every hue at full color.
export const hueStrip = (): string[] =>
  Array.from({ length: PICKER_HUES }, (_, step) => toHex({ h: (step * 360) / PICKER_HUES, s: 0.85, l: 0.6 }))

// The picker's bottom strip: the color's hue from dark to light.
export const shadeStrip = (hex: string): string[] => {
  const color = toHsl(hex)
  return Array.from({ length: PICKER_SHADES }, (_, step) => toHex({ ...color, l: 0.25 + (0.6 * step) / (PICKER_SHADES - 1) }))
}
