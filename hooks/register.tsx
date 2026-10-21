import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { BottomPlace, PlayerSettings, TextSize, TopPlace, Track } from '../types'

const DEFAULTS: PlayerSettings = { top: 'center', size: 'small', bottom: 'model' }

const track = atom({ plugin: 'now-playing', key: 'track' } as const, null)
const settings = atom({ plugin: 'now-playing', key: 'settings' } as const, DEFAULTS)
const frame = atom({ plugin: 'now-playing', key: 'frame' } as const, 0)
const error = atom({ plugin: 'now-playing', key: 'error' } as const, null)

const VERSION = '1.1.0'
const TOP_PLACES: readonly TopPlace[] = ['off', 'left', 'center', 'right']
const TEXT_SIZES: readonly TextSize[] = ['small', 'normal']
const BOTTOM_PLACES: readonly BottomPlace[] = ['off', 'auto', 'model']
const EQUALIZER = ['▂▅▃', '▅▃▇', '▃▇▂', '▇▂▅', '▄▆▃', '▆▃▄']
const EQUALIZER_PAUSED = '▁▁▁'
const FRAME_MS = 300
const LINE_MAX = 60
const RESTART_MS = 3000
const MAX_FAILED_STARTS = 5
const STDERR_KEPT = 300

const JUSTIFY = { left: 'flex-start', center: 'center', right: 'flex-end' } as const
const TEXT_SIZE = { small: 'caption', normal: 'body' } as const

const TOP_LABELS: Record<TopPlace, string> = { off: 'выкл', left: 'слева', center: 'по центру', right: 'справа' }
const SIZE_LABELS: Record<TextSize, string> = { small: 'маленький', normal: 'обычный' }
const BOTTOM_LABELS: Record<BottomPlace, string> = { off: 'выкл', auto: 'у «Auto»', model: 'у модели' }

// Tags that streaming sites and browsers append to titles.
const JUNK =
  /\s*[([](?:official\s+)?(?:music\s+|lyric\s+)?(?:video|audio|visuali[sz]er|lyrics?)(?:\s+video)?[)\]]|\s*[([](?:hd|hq|4k|official|клип|премьера клипа|премьера)[)\]]/gi

export const cleanTrack = (raw: Track): Track => {
  let artist = raw.artist.trim()
  let title = raw.title.replace(JUNK, '').trim()

  // Browser tabs often give no artist and "Artist - Title" as the title.
  if (artist === '') {
    const split = title.match(/^(.+?)\s+[-–—]\s+(.+)$/)
    if (split?.[1] !== undefined && split[2] !== undefined) {
      artist = split[1]
      title = split[2]
    }
  }
  artist = artist.replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/, '').trim()

  return { ...raw, artist, title }
}

export const trackText = (one: Track): string =>
  one.artist === '' ? one.title : `${one.artist} — ${one.title}`

const equalizer = (one: Track, at: number): string =>
  one.isPlaying ? (EQUALIZER[at % EQUALIZER.length] ?? EQUALIZER_PAUSED) : EQUALIZER_PAUSED

const clip = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text

const lineText = (one: Track, at: number): string => `${equalizer(one, at)}  ${clip(trackText(one), LINE_MAX)}`

const isOneOf = <T extends string>(options: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (options as readonly string[]).includes(value)

// Reads saved settings, falling back to the 1.0 `mode` key, then the defaults.
const loadSettings = async ($: EngineInterface): Promise<PlayerSettings> => {
  const saved = (await $.store.get('settings')) as Partial<PlayerSettings> | undefined
  if (saved !== undefined && saved !== null && typeof saved === 'object') {
    return {
      top: isOneOf(TOP_PLACES, saved.top) ? saved.top : DEFAULTS.top,
      size: isOneOf(TEXT_SIZES, saved.size) ? saved.size : DEFAULTS.size,
      bottom: isOneOf(BOTTOM_PLACES, saved.bottom) ? saved.bottom : DEFAULTS.bottom,
    }
  }
  const mode = await $.store.get('mode')
  return {
    ...DEFAULTS,
    top: mode === 'line' || mode === 'off' ? 'off' : DEFAULTS.top,
    bottom: mode === 'bar' || mode === 'off' ? 'off' : DEFAULTS.bottom,
  }
}

const refreshStatus = async ($: EngineInterface): Promise<void> => {
  const [chosen, playing, at] = await Promise.all([read($, settings), read($, track), read($, frame)])

  $.ui.status(chosen.bottom === 'model' && playing !== null ? lineText(playing, at) : undefined)
}

const choose = async ($: EngineInterface, change: Partial<PlayerSettings>): Promise<PlayerSettings> => {
  const chosen = await update($, settings, current => ({ ...current, ...change }))
  await $.store.set('settings', chosen)
  await refreshStatus($)
  return chosen
}

// Feeds the helper's JSON lines into `track` for the session's life,
// restarting it if it dies and giving up if it keeps failing to start.
const watch = async ($: EngineInterface): Promise<void> => {
  const script = `${$.plugin.root}\\helper\\now-playing.ps1`
  let failedStarts = 0

  while (failedStarts < MAX_FAILED_STARTS) {
    let isHeard = false
    let pending = ''
    let stderr = ''

    try {
      const helper = $.process.spawn({
        argv: ['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
      })
      for await (const { stream, text } of helper) {
        if (stream === 'stderr') {
          stderr = (stderr + text).slice(-STDERR_KEPT)
          continue
        }
        pending += text
        const lines = pending.split('\n')
        pending = lines.pop() ?? ''
        for (const line of lines) {
          if (line.trim() === '') continue
          const message = JSON.parse(line) as { track?: Track | null; error?: string }
          if (message.error !== undefined) {
            stderr = message.error
            continue
          }
          isHeard = true
          failedStarts = 0
          const next = message.track ? cleanTrack(message.track) : null
          await update($, error, () => null)
          await update($, track, () => next)
          await refreshStatus($)
        }
      }
    } catch (thrown) {
      stderr = thrown instanceof Error ? thrown.message : String(thrown)
    }

    if (!isHeard) {
      failedStarts += 1
      const detail = stderr.trim() === '' ? '' : ` (${stderr.trim()})`
      await update($, error, () => `помощник не запустился или сразу закрылся${detail}. Пока плеер работает только на Windows.`)
    }
    await update($, track, () => null)
    await refreshStatus($)
    await $.clock.sleep(RESTART_MS)
  }
}

const tick = async ($: EngineInterface): Promise<void> => {
  const [chosen, playing] = await Promise.all([read($, settings), read($, track)])
  if ((chosen.top === 'off' && chosen.bottom === 'off') || playing === null || !playing.isPlaying) return
  await update($, frame, at => (at + 1) % 1_000_000)
  if (chosen.bottom === 'model') await refreshStatus($)
}

const HELP = [
  'Настройки удобнее менять кнопками: просто /player.',
  '',
  '/player top off|left|center|right — полоса над полем ввода',
  '/player size small|normal         — размер её текста',
  '/player bottom off|auto|model     — строчка внизу: у «Auto» или у модели',
  '/player off | on                  — выключить или включить всё',
  '/player debug                     — что происходит внутри (для поиска багов)',
].join('\n')

const summary = (chosen: PlayerSettings): string =>
  `Над полем: ${TOP_LABELS[chosen.top]} · Размер: ${SIZE_LABELS[chosen.size]} · Внизу: ${BOTTOM_LABELS[chosen.bottom]}`

const nowText = (playing: Track | null, failure: string | null): string =>
  failure !== null
    ? `Ошибка: ${failure}`
    : playing === null
      ? 'Сейчас ничего не играет.'
      : `${playing.isPlaying ? 'Играет' : 'На паузе'}: ${trackText(playing)} (${playing.app})`

// What the drawing hooks have seen since the module loaded, for /player debug.
// Module variables on purpose: a render hook may not write state.
const seen = {
  bandCalls: 0,
  bandDrawn: 0,
  bandSurface: '—',
  bandBelow: '—',
  bandSkipped: '—',
  bandFailure: '—',
  modeCalls: 0,
  modeDrawn: 0,
  panelDrawn: 0,
}

const describe = (element: unknown): string => {
  if (element === null || element === undefined) return 'ничего'
  if (typeof element !== 'object') return typeof element
  const { type, ref } = element as { type?: unknown; ref?: unknown }
  return type === 'engine' ? `engine (ref ${String(ref)})` : String(type)
}

// Applies `/player <args>`; answers what changed, or null when it means nothing.
const applyArgs = async ($: EngineInterface, words: string[]): Promise<string | null> => {
  const [what, value] = words
  const current = await read($, settings)

  if (what === 'top' && isOneOf(TOP_PLACES, value)) {
    await choose($, { top: value })
    return `Над полем ввода: ${TOP_LABELS[value]}.`
  }
  if (what === 'size' && isOneOf(TEXT_SIZES, value)) {
    await choose($, { size: value })
    return `Размер текста: ${SIZE_LABELS[value]}.`
  }
  if (what === 'bottom' && isOneOf(BOTTOM_PLACES, value)) {
    await choose($, { bottom: value })
    return `Строчка внизу: ${BOTTOM_LABELS[value]}.`
  }
  if (value !== undefined) return null

  // Whole-player switches, plus the 1.0 commands so old habits keep working.
  const top = current.top === 'off' ? DEFAULTS.top : current.top
  const bottom = current.bottom === 'off' ? DEFAULTS.bottom : current.bottom
  const switches: Record<string, Partial<PlayerSettings>> = {
    off: { top: 'off', bottom: 'off' },
    on: { top, bottom },
    both: { top, bottom },
    bar: { top, bottom: 'off' },
    line: { top: 'off', bottom },
  }
  const change = what === undefined ? undefined : switches[what]
  if (change === undefined) return null
  const chosen = await choose($, change)
  return what === 'off' ? 'Плеер выключен. Включить обратно: /player on' : summary(chosen)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)

    const loaded = await loadSettings($)
    await update($, settings, () => loaded)

    await $.command.register({
      name: 'player',
      description: 'Плеер: что играет и где его показывать',
      argumentHint: '[top|size|bottom|off|on|debug]',
    })

    // Animates the equalizer only while something plays and is on screen.
    $.clock.every(FRAME_MS, () => {
      tick($).catch(() => {
        // The module is unloading; the next load starts its own timer.
      })
    })

    watch($).catch(() => {
      // The module is unloading; the next load starts its own helper.
    })

    return started
  })

  on('command.run', { command: 'player' }, async ($, e) => {
    const words = e.args.trim().toLowerCase().split(/\s+/).filter(word => word !== '')

    if (words[0] === 'debug') {
      const [chosen, playing, failure] = await Promise.all([read($, settings), read($, track), read($, error)])
      const surfaces = await $.session.surfaces()
      return {
        text: [
          `now-playing ${VERSION}`,
          `Поверхности сессии: ${surfaces.length === 0 ? 'нет' : surfaces.join(', ')}`,
          summary(chosen),
          nowText(playing, failure),
          '',
          'Полоса над полем ввода:',
          `  приложение просило нарисовать: ${seen.bandCalls} раз`,
          `  плеер нарисован: ${seen.bandDrawn} раз`,
          `  последняя поверхность: ${seen.bandSurface}`,
          `  под плеером: ${seen.bandBelow}`,
          `  последний раз не рисовал, потому что: ${seen.bandSkipped}`,
          `  ошибка: ${seen.bandFailure}`,
          '',
          'Строчка у «Auto»:',
          `  приложение просило нарисовать: ${seen.modeCalls} раз`,
          `  трек добавлен: ${seen.modeDrawn} раз`,
          '',
          `Панель с кнопками нарисована: ${seen.panelDrawn} раз`,
        ].join('\n'),
      }
    }

    if (words.length > 0) {
      const said = await applyArgs($, words)
      return { text: said ?? `Не знаю «${words.join(' ')}».\n\n${HELP}` }
    }

    // Bare /player: surfaces that draw the panel replace this text with buttons.
    const [chosen, playing, failure] = await Promise.all([read($, settings), read($, track), read($, error)])
    return { text: `${nowText(playing, failure)}\n${summary(chosen)}\n\n${HELP}` }
  })

  on('ui.render', { component: 'CommandOutput', props: { command: 'player' } }, async ($, e, next) => {
    if (e.props.args.trim() !== '' || e.props.isErrored) return next(e)

    const [chosen, playing, failure] = await Promise.all([read($, settings), read($, track), read($, error)])
    const { Box, Button, Text } = $.ui.resolve(e)

    const row = <T extends string>(
      title: string,
      field: keyof PlayerSettings,
      options: readonly T[],
      labels: Record<T, string>,
      selected: T,
    ) => (
      <Box flexDirection="column">
        <Text dimColor>{title}</Text>
        <Box flexDirection="row" gap="xs">
          {options.map(option => (
            <Button
              key={`${field}-${option}`}
              label={labels[option]}
              variant={option === selected ? 'primary' : 'secondary'}
              onPress={() => {
                void choose($, { [field]: option })
              }}
            />
          ))}
        </Box>
      </Box>
    )

    seen.panelDrawn += 1

    return (
      <Box flexDirection="column" gap="sm">
        <Text>{nowText(playing, failure)}</Text>
        {row('Над полем ввода', 'top', TOP_PLACES, TOP_LABELS, chosen.top)}
        {row('Размер текста', 'size', TEXT_SIZES, SIZE_LABELS, chosen.size)}
        {row('Внизу', 'bottom', BOTTOM_PLACES, BOTTOM_LABELS, chosen.bottom)}
      </Box>
    )
  })

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    seen.modeCalls += 1
    const [chosen, playing, at] = await Promise.all([read($, settings), read($, track), read($, frame)])

    if (chosen.bottom !== 'auto' || playing === null) return next(e)

    seen.modeDrawn += 1
    return next({ ...e, props: { ...e.props, modes: [...e.props.modes, lineText(playing, at)] } })
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    seen.bandCalls += 1
    seen.bandSurface = e.surface
    const [chosen, playing, at] = await Promise.all([read($, settings), read($, track), read($, frame)])
    // Whatever other plugins put in the band stays; the player goes under it.
    const others = await next(e)
    seen.bandBelow = describe(others)

    if (e.props.hasSurvey || playing === null || chosen.top === 'off') {
      seen.bandSkipped = e.props.hasSurvey ? 'там опрос' : playing === null ? 'ничего не играет' : 'выключена'
      return others
    }

    try {
      const { Box, Text } = $.ui.resolve(e)
      const player = (
        <Box key="player" justifyContent={JUSTIFY[chosen.top]}>
          <Text size={TEXT_SIZE[chosen.size]} dimColor={!playing.isPlaying} wrap="truncate-end">
            {`${equalizer(playing, at)}  ${trackText(playing)}`}
          </Text>
        </Box>
      )
      seen.bandDrawn += 1

      // A bare engine node is the engine's own band, empty outside a survey.
      const isAlone = others === null || others === undefined || (others as { type?: unknown }).type === 'engine'

      return isAlone ? player : (
        <Box flexDirection="column">
          {others}
          {player}
        </Box>
      )
    } catch (thrown) {
      seen.bandFailure = thrown instanceof Error ? thrown.message : String(thrown)
      return others
    }
  })
}
