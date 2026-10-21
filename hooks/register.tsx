import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Mode, Track } from '../types'

const track = atom({ plugin: 'now-playing', key: 'track' } as const, null)
const mode = atom({ plugin: 'now-playing', key: 'mode' } as const, 'both')
const frame = atom({ plugin: 'now-playing', key: 'frame' } as const, 0)
const error = atom({ plugin: 'now-playing', key: 'error' } as const, null)

const VERSION = '1.0.3'
const MODES: readonly Mode[] = ['bar', 'line', 'both', 'off']
const EQUALIZER = ['▂▅▃', '▅▃▇', '▃▇▂', '▇▂▅', '▄▆▃', '▆▃▄']
const EQUALIZER_PAUSED = '▁▁▁'
const FRAME_MS = 300
const LINE_MAX = 60
const RESTART_MS = 3000
const MAX_FAILED_STARTS = 5
const STDERR_KEPT = 300

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

const showsBar = (current: Mode): boolean => current === 'bar' || current === 'both'
const showsLine = (current: Mode): boolean => current === 'line' || current === 'both'

const refreshStatus = async ($: EngineInterface): Promise<void> => {
  const [current, playing, at] = await Promise.all([read($, mode), read($, track), read($, frame)])

  $.ui.status(
    showsLine(current) && playing !== null
      ? `${equalizer(playing, at)}  ${clip(trackText(playing), LINE_MAX)}`
      : undefined,
  )
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
  const [current, playing] = await Promise.all([read($, mode), read($, track)])
  if (current === 'off' || playing === null || !playing.isPlaying) return
  await update($, frame, at => (at + 1) % 1_000_000)
  if (showsLine(current)) await refreshStatus($)
}

const HELP = [
  '/player bar   — плеер над полем ввода',
  '/player line  — строчка возле модели',
  '/player both  — оба сразу',
  '/player off   — выключить',
  '/player debug — что происходит внутри (для поиска багов)',
].join('\n')

// What the band hook has seen since the module loaded, for /player debug.
// Module variables on purpose: a render hook may not write state.
const band = {
  calls: 0,
  drawn: 0,
  surface: '—',
  below: '—',
  skipped: '—',
  failure: '—',
}

const describe = (element: unknown): string => {
  if (element === null || element === undefined) return 'ничего'
  if (typeof element !== 'object') return typeof element
  const { type, ref } = element as { type?: unknown; ref?: unknown }
  return type === 'engine' ? `engine (ref ${String(ref)})` : String(type)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)

    const saved = await $.store.get('mode')
    if (typeof saved === 'string' && (MODES as readonly string[]).includes(saved)) {
      await update($, mode, () => saved as Mode)
    }

    await $.command.register({
      name: 'player',
      description: 'Плеер: что сейчас играет и где его показывать',
      argumentHint: '[bar|line|both|off]',
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
    const asked = e.args.trim().toLowerCase()

    if ((MODES as readonly string[]).includes(asked)) {
      const chosen = asked as Mode
      await update($, mode, () => chosen)
      await $.store.set('mode', chosen)
      await refreshStatus($)
      const said: Record<Mode, string> = {
        bar: 'Плеер теперь над полем ввода.',
        line: 'Плеер теперь строчкой возле модели.',
        both: 'Плеер теперь и над полем ввода, и строчкой возле модели.',
        off: 'Плеер выключен. Включить обратно: /player both',
      }
      return { text: said[chosen] }
    }

    const [current, playing, failure] = await Promise.all([read($, mode), read($, track), read($, error)])
    const now =
      failure !== null
        ? `Ошибка: ${failure}`
        : playing === null
          ? 'Сейчас ничего не играет.'
          : `${playing.isPlaying ? 'Играет' : 'На паузе'}: ${trackText(playing)} (${playing.app})`

    if (asked === 'debug') {
      const surfaces = await $.session.surfaces()
      return {
        text: [
          `now-playing ${VERSION}`,
          `Поверхности сессии: ${surfaces.length === 0 ? 'нет' : surfaces.join(', ')}`,
          `Режим: ${current}`,
          now,
          '',
          'Полоса над полем ввода:',
          `  приложение просило нарисовать: ${band.calls} раз`,
          `  плеер нарисован: ${band.drawn} раз`,
          `  последняя поверхность: ${band.surface}`,
          `  под плеером: ${band.below}`,
          `  последний раз не рисовал, потому что: ${band.skipped}`,
          `  ошибка: ${band.failure}`,
        ].join('\n'),
      }
    }

    const intro = asked === '' ? '' : `Не знаю «${asked}».\n\n`

    return { text: `${intro}${now}\nРежим: ${current}\n\n${HELP}` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    band.calls += 1
    band.surface = e.surface
    const [current, playing, at] = await Promise.all([read($, mode), read($, track), read($, frame)])
    // Whatever other plugins put in the band stays; the player goes under it.
    const others = await next(e)
    band.below = describe(others)

    if (e.props.hasSurvey || playing === null || !showsBar(current)) {
      band.skipped = e.props.hasSurvey ? 'там опрос' : playing === null ? 'ничего не играет' : `режим ${current}`
      return others
    }

    try {
      const { Box, Text } = $.ui.resolve(e)
      const player = (
        <Box justifyContent="center">
          <Text size="caption" dimColor={!playing.isPlaying} wrap="truncate-end">
            {`${equalizer(playing, at)}  ${trackText(playing)}`}
          </Text>
        </Box>
      )
      band.drawn += 1

      // A bare engine node is the engine's own band, empty outside a survey.
      const isAlone = others === null || others === undefined || (others as { type?: unknown }).type === 'engine'

      return isAlone ? player : (
        <Box flexDirection="column">
          {others}
          {player}
        </Box>
      )
    } catch (thrown) {
      band.failure = thrown instanceof Error ? thrown.message : String(thrown)
      return others
    }
  })
}
