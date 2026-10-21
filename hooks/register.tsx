import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { BottomPlace, PlayerSettings, Switch, TextSize, TopPlace, Track } from '../types'

const DEFAULTS: PlayerSettings = { top: 'center', size: 'small', bottom: 'model', controls: 'on', time: 'on' }

const track = atom({ plugin: 'now-playing', key: 'track' } as const, null)
const settings = atom({ plugin: 'now-playing', key: 'settings' } as const, DEFAULTS)
const now = atom({ plugin: 'now-playing', key: 'now' } as const, 0)
const error = atom({ plugin: 'now-playing', key: 'error' } as const, null)

const VERSION = '1.2.0'
const TOP_PLACES: readonly TopPlace[] = ['off', 'left', 'center', 'right']
const TEXT_SIZES: readonly TextSize[] = ['small', 'normal']
const BOTTOM_PLACES: readonly BottomPlace[] = ['off', 'model']
const SWITCHES: readonly Switch[] = ['off', 'on']
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
const BOTTOM_LABELS: Record<BottomPlace, string> = { off: 'выкл', model: 'вкл' }
const SWITCH_LABELS: Record<Switch, string> = { off: 'выкл', on: 'вкл' }
// What `/player bottom` accepts; 1.1.0's `auto` now means the line beside the model.
const BOTTOM_WORDS: Record<string, BottomPlace> = { off: 'off', on: 'model', model: 'model', auto: 'model' }

// What the helper presses, and the /player words for it.
type Command = 'previous' | 'toggle' | 'play' | 'pause' | 'next'
const COMMAND_WORDS: Record<string, Command> = {
  prev: 'previous',
  previous: 'previous',
  back: 'previous',
  pause: 'pause',
  play: 'play',
  next: 'next',
}
const COMMAND_ANSWERS: Record<Command, string> = {
  previous: 'Предыдущий трек.',
  toggle: 'Готово.',
  play: 'Играет.',
  pause: 'Пауза.',
  next: 'Следующий трек.',
}
// Text presentation selectors keep the glyphs out of the emoji font.
const GLYPHS = { previous: '⏮\uFE0E', pause: '⏸\uFE0E', play: '▶\uFE0E', next: '⏭\uFE0E' } as const

// A word's entry in a table, never one of Object's own names.
const lookup = <T,>(table: Record<string, T>, word: string | undefined): T | undefined =>
  word !== undefined && Object.hasOwn(table, word) ? table[word] : undefined

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
  one.isPlaying ? (EQUALIZER[Math.floor(at / FRAME_MS) % EQUALIZER.length] ?? EQUALIZER_PAUSED) : EQUALIZER_PAUSED

const clip = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text

const clockText = (seconds: number): string => {
  const whole = Math.floor(seconds)
  const [hours, minutes, rest] = [Math.floor(whole / 3600), Math.floor(whole / 60) % 60, whole % 60]
  const tail = String(rest).padStart(2, '0')
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${tail}` : `${minutes}:${tail}`
}

// "1:23 / 3:45" at `at`, counting on from the app's last report while it plays;
// undefined when the app reports no length.
export const timeText = (one: Track, at: number): string | undefined => {
  const duration = one.duration ?? 0
  if (!(duration >= 1)) return undefined
  const since = one.isPlaying ? Math.max(0, at - (one.updatedAt ?? at)) / 1000 : 0
  const position = Math.min(duration, Math.max(0, (one.position ?? 0) + since))
  return `${clockText(position)} / ${clockText(duration)}`
}

const lineText = (one: Track, at: number, isTimed: boolean): string => {
  const time = isTimed ? timeText(one, at) : undefined
  return `${equalizer(one, at)}  ${clip(trackText(one), LINE_MAX)}${time === undefined ? '' : `  ${time}`}`
}

const isOneOf = <T extends string>(options: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (options as readonly string[]).includes(value)

// Reads saved settings, falling back to the 1.0 `mode` key, then the defaults.
const loadSettings = async ($: EngineInterface): Promise<PlayerSettings> => {
  const saved = (await $.store.get('settings')) as Partial<PlayerSettings> | undefined
  if (saved !== undefined && saved !== null && typeof saved === 'object') {
    return {
      top: isOneOf(TOP_PLACES, saved.top) ? saved.top : DEFAULTS.top,
      size: isOneOf(TEXT_SIZES, saved.size) ? saved.size : DEFAULTS.size,
      bottom: lookup(BOTTOM_WORDS, String(saved.bottom)) ?? DEFAULTS.bottom,
      controls: isOneOf(SWITCHES, saved.controls) ? saved.controls : DEFAULTS.controls,
      time: isOneOf(SWITCHES, saved.time) ? saved.time : DEFAULTS.time,
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
  const [chosen, playing, at] = await Promise.all([read($, settings), read($, track), read($, now)])

  $.ui.status(chosen.bottom === 'model' && playing !== null ? lineText(playing, at, chosen.time === 'on') : undefined)
}

const choose = async ($: EngineInterface, change: Partial<PlayerSettings>): Promise<PlayerSettings> => {
  const chosen = await update($, settings, current => ({ ...current, ...change }))
  await $.store.set('settings', chosen)
  await refreshStatus($)
  return chosen
}

// The running helper's command file, from its first line; null while none runs.
let commandFile: string | null = null

// What the helper prints: its command file, a track, a press's outcome, or a failure.
type HelperLine = { commands?: string; track?: Track | null; command?: string; ok?: boolean; error?: string }

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
          const message = JSON.parse(line) as HelperLine
          if (message.error !== undefined) {
            stderr = message.error
            continue
          }
          isHeard = true
          failedStarts = 0
          if (message.commands !== undefined) {
            commandFile = message.commands
            continue
          }
          if (message.command !== undefined) {
            seen.lastAnswer = `${message.command}: ${message.ok === true ? 'приложение выполнило' : 'приложение отказалось'}`
            continue
          }
          const receivedAt = await $.clock.now()
          // A position with no report time counts from now.
          const next = message.track
            ? { ...cleanTrack(message.track), updatedAt: (message.track.updatedAt ?? 0) > 0 ? message.track.updatedAt : receivedAt }
            : null
          await update($, error, () => null)
          await update($, now, () => receivedAt)
          await update($, track, () => next)
          await refreshStatus($)
        }
      }
    } catch (thrown) {
      stderr = thrown instanceof Error ? thrown.message : String(thrown)
    }
    commandFile = null

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
  const at = await $.clock.now()
  await update($, now, () => at)
  if (chosen.bottom === 'model') await refreshStatus($)
}

const HELP = [
  'Настройки удобнее менять кнопками: просто /player.',
  '',
  '/player top off|left|center|right — полоса над полем ввода',
  '/player size small|normal         — размер её текста',
  '/player bottom off|on             — строчка внизу, у модели',
  '/player buttons off|on            — кнопки над полем ввода',
  '/player time off|on               — время трека',
  '/player prev|pause|play|next      — управлять музыкой',
  '/player off | on                  — выключить или включить всё',
  '/player debug                     — что происходит внутри (для поиска багов)',
].join('\n')

const summary = (chosen: PlayerSettings): string =>
  [
    `Над полем: ${TOP_LABELS[chosen.top]}`,
    `Размер: ${SIZE_LABELS[chosen.size]}`,
    `Внизу: ${BOTTOM_LABELS[chosen.bottom]}`,
    `Кнопки: ${SWITCH_LABELS[chosen.controls]}`,
    `Время: ${SWITCH_LABELS[chosen.time]}`,
  ].join(' · ')

// Readable names for the app ids Windows reports, first match wins.
const APP_NAMES: readonly [RegExp, string][] = [
  [/spotify/i, 'Spotify'],
  [/yandex\.?music/i, 'Яндекс Музыка'],
  [/yandex/i, 'Яндекс Браузер'],
  [/soundcloud/i, 'SoundCloud'],
  [/telegram/i, 'Telegram'],
  [/^chrome\._crx_/i, 'приложение Chrome'],
  [/^msedge\._crx_/i, 'приложение Edge'],
  [/chrome/i, 'Chrome'],
  [/msedge/i, 'Edge'],
  [/firefox/i, 'Firefox'],
  [/opera/i, 'Opera'],
  [/zunemusic|media\.?player/i, 'Медиаплеер Windows'],
  [/aimp/i, 'AIMP'],
  [/foobar/i, 'foobar2000'],
  [/vlc/i, 'VLC'],
]

export const appName = (id: string): string =>
  APP_NAMES.find(([pattern]) => pattern.test(id))?.[1] ?? id.replace(/\.exe$/i, '').replace(/[_!].*$/, '')

const nowText = (playing: Track | null, failure: string | null): string =>
  failure !== null
    ? `Ошибка: ${failure}`
    : playing === null
      ? 'Сейчас ничего не играет.'
      : `${playing.isPlaying ? 'Играет' : 'На паузе'}: ${trackText(playing)} (${appName(playing.app)})`

// What the drawing hooks have seen since the module loaded, for /player debug.
// Module variables on purpose: a render hook may not write state.
const seen = {
  bandCalls: 0,
  bandDrawn: 0,
  bandSurface: '—',
  bandBelow: '—',
  bandSkipped: '—',
  bandFailure: '—',
  panelDrawn: 0,
  lastCommand: '—',
  lastAnswer: '—',
  controlFailure: '—',
}

const describe = (element: unknown): string => {
  if (element === null || element === undefined) return 'ничего'
  if (typeof element !== 'object') return typeof element
  const { type, ref } = element as { type?: unknown; ref?: unknown }
  return type === 'engine' ? `engine (ref ${String(ref)})` : String(type)
}

// Hands a button press to the helper; answers what happened, in words.
const press = async ($: EngineInterface, command: Command): Promise<string> => {
  const [playing, failure] = await Promise.all([read($, track), read($, error)])
  if (commandFile === null) return failure === null ? 'Плеер ещё запускается, попробуй через секунду.' : `Ошибка: ${failure}`
  if (playing === null) return 'Сейчас ничего не играет.'

  try {
    await $.fs.write(commandFile, command)
    seen.lastCommand = command
    return command === 'toggle' ? (playing.isPlaying ? COMMAND_ANSWERS.pause : COMMAND_ANSWERS.play) : COMMAND_ANSWERS[command]
  } catch (thrown) {
    seen.controlFailure = thrown instanceof Error ? thrown.message : String(thrown)
    return `Не получилось передать команду: ${seen.controlFailure}`
  }
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
  const bottom = lookup(BOTTOM_WORDS, value)
  if (what === 'bottom' && bottom !== undefined) {
    await choose($, { bottom })
    return `Строчка внизу: ${BOTTOM_LABELS[bottom]}.`
  }
  if ((what === 'buttons' || what === 'controls') && isOneOf(SWITCHES, value)) {
    await choose($, { controls: value })
    return `Кнопки: ${SWITCH_LABELS[value]}.`
  }
  if (what === 'time' && isOneOf(SWITCHES, value)) {
    await choose($, { time: value })
    return `Время трека: ${SWITCH_LABELS[value]}.`
  }
  if (value !== undefined) return null

  const command = lookup(COMMAND_WORDS, what)
  if (command !== undefined) return press($, command)

  // Whole-player switches, plus the 1.0 commands so old habits keep working.
  const top = current.top === 'off' ? DEFAULTS.top : current.top
  const switches: Record<string, Partial<PlayerSettings>> = {
    off: { top: 'off', bottom: 'off' },
    on: { top, bottom: 'model' },
    both: { top, bottom: 'model' },
    bar: { top, bottom: 'off' },
    line: { top: 'off', bottom: 'model' },
  }
  const change = lookup(switches, what)
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
      argumentHint: '[next|pause|play|prev|top|size|bottom|buttons|time|off|on|debug]',
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
      const at = await $.clock.now()
      const timeline =
        playing === null
          ? '—'
          : `позиция ${playing.position ?? '—'} с, длина ${playing.duration ?? '—'} с, ` +
            `сообщено ${Math.round((at - (playing.updatedAt ?? at)) / 1000)} с назад`
      return {
        text: [
          `now-playing ${VERSION}`,
          `Поверхности сессии: ${surfaces.length === 0 ? 'нет' : surfaces.join(', ')}`,
          summary(chosen),
          nowText(playing, failure),
          `Источник как его называет Windows: ${playing?.app ?? '—'}`,
          '',
          'Полоса над полем ввода:',
          `  приложение просило нарисовать: ${seen.bandCalls} раз`,
          `  плеер нарисован: ${seen.bandDrawn} раз`,
          `  последняя поверхность: ${seen.bandSurface}`,
          `  под плеером: ${seen.bandBelow}`,
          `  последний раз не рисовал, потому что: ${seen.bandSkipped}`,
          `  ошибка: ${seen.bandFailure}`,
          '',
          `Панель с кнопками нарисована: ${seen.panelDrawn} раз`,
          '',
          'Управление и время:',
          `  файл команд: ${commandFile ?? 'нет'}`,
          `  последняя команда: ${seen.lastCommand}`,
          `  ответ: ${seen.lastAnswer}`,
          `  ошибка: ${seen.controlFailure}`,
          `  время от Windows: ${timeline}`,
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
        {playing === null ? null : (
          <Box flexDirection="row" gap="xs">
            <Button key="panel-previous" label={`${GLYPHS.previous} назад`} onPress={() => void press($, 'previous')} />
            <Button
              key="panel-toggle"
              label={playing.isPlaying ? `${GLYPHS.pause} пауза` : `${GLYPHS.play} играть`}
              onPress={() => void press($, 'toggle')}
            />
            <Button key="panel-next" label={`вперёд ${GLYPHS.next}`} onPress={() => void press($, 'next')} />
          </Box>
        )}
        {row('Над полем ввода', 'top', TOP_PLACES, TOP_LABELS, chosen.top)}
        {row('Размер текста', 'size', TEXT_SIZES, SIZE_LABELS, chosen.size)}
        {row('Внизу', 'bottom', BOTTOM_PLACES, BOTTOM_LABELS, chosen.bottom)}
        {row('Кнопки', 'controls', SWITCHES, SWITCH_LABELS, chosen.controls)}
        {row('Время трека', 'time', SWITCHES, SWITCH_LABELS, chosen.time)}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    seen.bandCalls += 1
    seen.bandSurface = e.surface
    const [chosen, playing, at] = await Promise.all([read($, settings), read($, track), read($, now)])
    // Whatever other plugins put in the band stays; the player goes under it.
    const others = await next(e)
    seen.bandBelow = describe(others)

    if (e.props.hasSurvey || playing === null || chosen.top === 'off') {
      seen.bandSkipped = e.props.hasSurvey ? 'там опрос' : playing === null ? 'ничего не играет' : 'выключена'
      return others
    }

    try {
      const { Box, Button, Text } = $.ui.resolve(e)
      const time = chosen.time === 'on' ? timeText(playing, at) : undefined
      const player = (
        <Box key="player" flexDirection="row" alignItems="center" gap="sm" justifyContent={JUSTIFY[chosen.top]}>
          {chosen.controls === 'on' ? (
            <Box key="controls" flexDirection="row" gap="xs">
              <Button key="previous" label={GLYPHS.previous} plain dimColor onPress={() => void press($, 'previous')} />
              <Button
                key="toggle"
                label={playing.isPlaying ? GLYPHS.pause : GLYPHS.play}
                plain
                dimColor
                onPress={() => void press($, 'toggle')}
              />
              <Button key="next" label={GLYPHS.next} plain dimColor onPress={() => void press($, 'next')} />
            </Box>
          ) : null}
          <Text size={TEXT_SIZE[chosen.size]} dimColor={!playing.isPlaying} wrap="truncate-end">
            {`${equalizer(playing, at)}  ${trackText(playing)}`}
          </Text>
          {time === undefined ? null : (
            <Text size={TEXT_SIZE[chosen.size]} dimColor tabular>
              {time}
            </Text>
          )}
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
