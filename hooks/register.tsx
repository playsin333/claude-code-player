import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type {
  BottomPlace,
  FoundLyrics,
  LyricLine,
  PlayerSettings,
  Session,
  Source,
  Switch,
  TextSize,
  TopPlace,
  Track,
} from '../types'

import { EQUALIZER, EQUALIZER_PAUSED, FRAME_MS } from './equalizer'
import { parseLrc, reveal } from './lyrics'
import type { LyricsProps } from './lyrics'

const DEFAULTS: PlayerSettings = {
  top: 'center',
  size: 'small',
  bottom: 'model',
  controls: 'on',
  time: 'on',
  lyrics: 'off',
  hidden: [],
}

const sessions = atom({ plugin: 'now-playing', key: 'sessions' } as const, [])
const track = atom({ plugin: 'now-playing', key: 'track' } as const, null)
const sources = atom({ plugin: 'now-playing', key: 'sources' } as const, [])
const lyrics = atom({ plugin: 'now-playing', key: 'lyrics' } as const, null)
const settings = atom({ plugin: 'now-playing', key: 'settings' } as const, DEFAULTS)
const now = atom({ plugin: 'now-playing', key: 'now' } as const, 0)
const error = atom({ plugin: 'now-playing', key: 'error' } as const, null)

const VERSION = '1.5.0'
const TOP_PLACES: readonly TopPlace[] = ['off', 'left', 'center', 'right']
const TEXT_SIZES: readonly TextSize[] = ['small', 'normal']
const BOTTOM_PLACES: readonly BottomPlace[] = ['off', 'model']
const SWITCHES: readonly Switch[] = ['off', 'on']
const LINE_MAX = 60
// How far the app's report may stray from the time counted on before it is shown.
const DRIFT_S = 2
const SOURCE_MAX = 32
// The lyrics' room in the band, in columns: fixed for the track, so a word
// coming in moves nothing around it.
const LYRICS_MIN = 20
const LYRICS_MAX = 56
const BAND_OTHERS = 30
const LRCLIB = 'https://lrclib.net/api/search'
// Where bugs and questions go: the repository's issues, with a form for each.
const ISSUES = 'https://github.com/playsin333/claude-code-player/issues'
const BUG_INTRO = 'Чтобы сообщить о баге, открой форму и вставь в поле «Диагностика» всё, что ниже ссылки:'
// How far a found track's length may be from the playing one's, in seconds:
// the nearest within SLACK first, and none past FAR, another version's timing.
const DURATION_SLACK_S = 3
const DURATION_FAR_S = 10
// A failed lyrics search is tried again after this long, not on every report.
const LYRICS_RETRY_MS = 60_000
const RESTART_MS = 3000
const MAX_FAILED_STARTS = 5
const STDERR_KEPT = 300

const JUSTIFY = { left: 'flex-start', center: 'center', right: 'flex-end' } as const
// The surfaces that run a `Client`; the others draw one as nothing.
const LIVE_SURFACES: readonly string[] = ['terminal', 'desktop']
const TEXT_SIZE = { small: 'caption', normal: 'body' } as const

const TOP_LABELS: Record<TopPlace, string> = { off: 'выкл', left: 'слева', center: 'по центру', right: 'справа' }
const SIZE_LABELS: Record<TextSize, string> = { small: 'маленький', normal: 'обычный' }
const BOTTOM_LABELS: Record<BottomPlace, string> = { off: 'выкл', model: 'вкл' }
const SWITCH_LABELS: Record<Switch, string> = { off: 'выкл', on: 'вкл' }
const LYRICS_NOTE = 'Текст ищется на lrclib.net: туда уходят исполнитель и название трека.'
const LYRICS_STATUS: Record<FoundLyrics['status'], string> = {
  searching: 'ищется',
  found: 'найден',
  missing: 'не найден на lrclib.net',
  failed: 'ошибка',
}
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

export const cleanTrack = <T extends Track>(raw: T): T => {
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

// Seconds into the track at `at`, counting on from the app's last report while it plays.
const positionAt = (one: Track, at: number): number =>
  (one.position ?? 0) + (one.isPlaying ? Math.max(0, at - (one.updatedAt ?? at)) / 1000 : 0)

// "1:23 / 3:45" at `at`; undefined when the app reports no length.
export const timeText = (one: Track, at: number): string | undefined => {
  const duration = one.duration ?? 0
  if (!(duration >= 1)) return undefined
  const position = Math.min(duration, Math.max(0, positionAt(one, at)))
  return `${clockText(position)} / ${clockText(duration)}`
}

// Whether `next` shows as `shown` does at `at`: the same track and state, and
// a time no more than DRIFT_S off.
const isSame = (shown: Track | null, next: Track | null, at: number): boolean =>
  shown === null || next === null
    ? shown === next
    : shown.app === next.app &&
      shown.artist === next.artist &&
      shown.title === next.title &&
      shown.isPlaying === next.isPlaying &&
      (shown.duration ?? 0) === (next.duration ?? 0) &&
      Math.abs(positionAt(shown, at) - positionAt(next, at)) < DRIFT_S

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
      lyrics: isOneOf(SWITCHES, saved.lyrics) ? saved.lyrics : DEFAULTS.lyrics,
      hidden: Array.isArray(saved.hidden) ? saved.hidden.filter((app): app is string => typeof app === 'string') : [],
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

// Which session to show. One that plays: the one shown last, then the one
// Windows calls current, then any. With none playing, the one shown last
// stays, so play resumes what was playing. Hidden apps are never picked.
export const pick = (all: readonly Session[], hidden: readonly string[], lastApp: string | undefined): Session | undefined => {
  const visible = all.filter(one => !hidden.includes(one.app))
  const last = visible.find(one => one.app === lastApp)
  const current = visible.find(one => one.isCurrent)
  return [last, current, ...visible].find(one => one?.isPlaying === true) ?? last ?? current ?? visible[0]
}

// Shows the session `pick` chooses from the ones last reported. Leaves `track`
// alone while it would show the same, so what draws it is not drawn again.
const select = async ($: EngineInterface): Promise<void> => {
  const [all, chosen, shown] = await Promise.all([read($, sessions), read($, settings), read($, track)])
  const next = pick(all, chosen.hidden, shown?.app) ?? null
  if (!isSame(shown, next, await $.clock.now())) await update($, track, () => next)
  await refreshStatus($)
  findLyrics($).catch(() => {
    // The module is unloading; the next load looks again.
  })
}

// What LRCLIB is searched by: the title without bracketed tags or features,
// the first artist without decoration (☆LiL PEEP☆).
export const searchTerms = (one: Track): { artist: string; title: string } => ({
  artist: (one.artist.split(/\s*(?:,|&|\bfeat\.?|\bft\.?|\bx\b)\s*/i)[0] ?? '').replace(/[^\p{L}\p{N}\s'.-]/gu, '').trim(),
  title: one.title
    .replace(/\s*[([][^)\]]*[)\]]/g, '')
    .replace(/\s+(?:feat|ft)\.?\s.*$/i, '')
    .trim(),
})

type LrclibHit = { syncedLyrics?: string | null; duration?: number }

const searchLrclib = async ($: EngineInterface, query: Record<string, string>): Promise<LrclibHit[]> => {
  const response = await $.http.fetch(`${LRCLIB}?${new URLSearchParams(query).toString()}`, {
    headers: { 'User-Agent': `now-playing/${VERSION} (https://github.com/playsin333/claude-code-player)` },
  })
  if (!response.ok) throw new Error(`lrclib.net ответил ${response.status}`)
  const hits = JSON.parse(response.text) as unknown
  return Array.isArray(hits) ? (hits as LrclibHit[]) : []
}

// The synced lyrics of the hit nearest the track's length; of the first hit
// with any when the length is unknown.
const bestLines = (hits: readonly LrclibHit[], duration: number | undefined): LyricLine[] => {
  const synced = hits.filter(hit => typeof hit.syncedLyrics === 'string' && hit.syncedLyrics !== '')
  const within = (slack: number) => synced.find(hit => Math.abs((hit.duration ?? 0) - (duration ?? 0)) <= slack)
  const hit = duration === undefined || duration < 1 ? synced[0] : (within(DURATION_SLACK_S) ?? within(DURATION_FAR_S))
  return parseLrc(hit?.syncedLyrics ?? '')
}

const lyricsKey = (one: Track): string => `${one.artist}\n${one.title}`

// Lyrics found this session, by track, so a track played again is not searched again.
const lyricsFound = new Map<string, LyricLine[]>()
// When the last search failed, so a dead network is not asked on every report.
let lyricsFailedAt = -Infinity

// Looks the shown track's lyrics up, once per track, while lyrics are on.
const findLyrics = async ($: EngineInterface): Promise<void> => {
  const [chosen, playing, known] = await Promise.all([read($, settings), read($, track), read($, lyrics)])
  if (chosen.lyrics === 'off' || playing === null) return
  const key = lyricsKey(playing)
  const isRetry = known?.status === 'failed' && (await $.clock.now()) - lyricsFailedAt >= LYRICS_RETRY_MS
  if (known?.key === key && !isRetry) return

  let found: FoundLyrics
  const cached = lyricsFound.get(key)
  if (cached !== undefined) {
    found = { key, status: cached.length > 0 ? 'found' : 'missing', lines: cached }
  } else {
    await update($, lyrics, (): FoundLyrics => ({ key, status: 'searching', lines: [] }))
    try {
      const { artist, title } = searchTerms(playing)
      const query: Record<string, string> = artist === '' ? { q: title } : { track_name: title, artist_name: artist }
      let lines = bestLines(await searchLrclib($, query), playing.duration)
      if (lines.length === 0 && artist !== '') {
        lines = bestLines(await searchLrclib($, { q: `${artist} ${title}` }), playing.duration)
      }
      lyricsFound.set(key, lines)
      found = { key, status: lines.length > 0 ? 'found' : 'missing', lines }
    } catch (thrown) {
      lyricsFailedAt = await $.clock.now()
      found = { key, status: 'failed', lines: [], detail: thrown instanceof Error ? thrown.message : String(thrown) }
    }
  }
  // Another track may be on by now; its own search writes its lyrics.
  const current = await read($, track)
  if (current !== null && lyricsKey(current) === key) await update($, lyrics, () => found)
}

// The shown track's lines, when lyrics are on and were found for it.
const linesFor = (chosen: PlayerSettings, playing: Track, sung: FoundLyrics | null): LyricLine[] | undefined =>
  chosen.lyrics === 'on' && sung?.status === 'found' && sung.key === lyricsKey(playing) ? sung.lines : undefined

// Each props handed to the lyrics gets its own stamp, so it counts on from its own position.
let lyricsStamps = 0

const lyricsProps = (one: Track, lines: LyricLine[], at: number, size: LyricsProps['size']): LyricsProps => ({
  lines,
  position: positionAt(one, at),
  isPlaying: one.isPlaying,
  title: trackText(one),
  size,
  stamp: (lyricsStamps += 1),
})

// Lists the reported apps for the panel, leaving the list alone while it stays the same.
const listSources = async ($: EngineInterface, all: readonly Session[]): Promise<void> => {
  const listed: Source[] = all.map(one => ({ app: one.app, text: trackText(one) }))
  if (JSON.stringify(listed) !== JSON.stringify(await read($, sources))) await update($, sources, () => listed)
}

const choose = async ($: EngineInterface, change: Partial<PlayerSettings>): Promise<PlayerSettings> => {
  const chosen = await update($, settings, current => ({ ...current, ...change }))
  await $.store.set('settings', chosen)
  await select($)
  return chosen
}

const toggleSource = async ($: EngineInterface, app: string): Promise<void> => {
  const { hidden } = await read($, settings)
  await choose($, { hidden: hidden.includes(app) ? hidden.filter(one => one !== app) : [...hidden, app] })
}

// The running helper's command file, from its first line; null while none runs.
let commandFile: string | null = null

// What the helper prints: its command file, the sessions, a press's outcome, or a failure.
type HelperLine = { commands?: string; sessions?: Session[]; command?: string; app?: string; ok?: boolean; error?: string }

// Feeds the helper's JSON lines into `sessions` for the session's life,
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
            const outcome = message.ok === true ? 'выполнило' : 'отказалось'
            seen.lastAnswer = `${message.command} в ${message.app ?? '—'}: приложение ${outcome}`
            continue
          }
          if (message.sessions === undefined) continue
          const [receivedAt, before] = await Promise.all([$.clock.now(), read($, sessions)])
          // A position with no report time counts from when it was first seen,
          // not from each report: a report about another app must not reset it.
          const reported = message.sessions.map(one => {
            const clean = cleanTrack(one)
            const seenBefore = before.find(
              was => was.app === clean.app && was.title === clean.title && was.position === clean.position,
            )
            return { ...clean, updatedAt: (one.updatedAt ?? 0) > 0 ? one.updatedAt : (seenBefore?.updatedAt ?? receivedAt) }
          })
          await update($, error, () => null)
          await update($, now, () => receivedAt)
          await update($, sessions, () => reported)
          await listSources($, reported)
          await select($)
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
    await update($, sessions, () => [])
    await listSources($, [])
    await select($)
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
  '/player lyrics off|on             — текст песни вместо названия',
  '/player prev|pause|play|next      — управлять музыкой',
  '/player off | on                  — выключить или включить всё',
  '/player debug                     — что происходит внутри (для поиска багов)',
  '/player bug                       — сообщить о баге: ссылка на форму и диагностика',
].join('\n')

const summary = (chosen: PlayerSettings): string =>
  [
    `Над полем: ${TOP_LABELS[chosen.top]}`,
    `Размер: ${SIZE_LABELS[chosen.size]}`,
    `Внизу: ${BOTTOM_LABELS[chosen.bottom]}`,
    `Кнопки: ${SWITCH_LABELS[chosen.controls]}`,
    `Время: ${SWITCH_LABELS[chosen.time]}`,
    `Текст: ${SWITCH_LABELS[chosen.lyrics]}`,
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
  clockAsks: 0,
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
    await $.fs.write(commandFile, JSON.stringify({ command, app: playing.app, title: playing.title }))
    seen.lastCommand = command
    return command === 'toggle' ? (playing.isPlaying ? COMMAND_ANSWERS.pause : COMMAND_ANSWERS.play) : COMMAND_ANSWERS[command]
  } catch (thrown) {
    seen.controlFailure = thrown instanceof Error ? thrown.message : String(thrown)
    return `Не получилось передать команду: ${seen.controlFailure}`
  }
}

// What /player debug says: what the player sees, chose and drew, for finding bugs.
const debugText = async ($: EngineInterface): Promise<string> => {
  const [chosen, playing, failure, all, sung] = await Promise.all([
    read($, settings),
    read($, track),
    read($, error),
    read($, sessions),
    read($, lyrics),
  ])
  const surfaces = await $.session.surfaces()
  const at = await $.clock.now()
  const listed = all.map(one => {
    const marks = [
      one.isPlaying ? 'играет' : 'пауза',
      ...(one.isCurrent ? ['текущая в Windows'] : []),
      ...(chosen.hidden.includes(one.app) ? ['скрыта'] : []),
      ...(one.app === playing?.app && one.title === playing.title ? ['показана'] : []),
    ]
    return `  ${appName(one.app)} (${one.app}), ${marks.join(', ')}: ${trackText(one)}`
  })
  // The app's own last report, which `track` follows only when it strays.
  const raw = all.find(one => one.app === playing?.app && one.title === playing.title) ?? playing
  const timeline =
    raw === null
      ? '—'
      : `позиция ${raw.position ?? '—'} с, длина ${raw.duration ?? '—'} с, ` +
        `сообщено ${Math.round((at - (raw.updatedAt ?? at)) / 1000)} с назад`
  return [
      `now-playing ${VERSION}`,
      `Поверхности сессии: ${surfaces.length === 0 ? 'нет' : surfaces.join(', ')}`,
      summary(chosen),
      nowText(playing, failure),
      `Источник как его называет Windows: ${playing?.app ?? '—'}`,
      `Скрытые источники: ${chosen.hidden.length === 0 ? 'нет' : chosen.hidden.join(', ')}`,
      `Текст песни: ${
        chosen.lyrics === 'off'
          ? 'выкл'
          : sung === null
            ? '—'
            : `${LYRICS_STATUS[sung.status]}${sung.status === 'found' ? `, строк: ${sung.lines.length}` : ''}` +
              `${sung.detail === undefined ? '' : ` (${sung.detail})`}`
      }`,
      '',
      all.length === 0 ? 'Медиасессии Windows: нет' : 'Медиасессии Windows:',
      ...listed,
      '',
      'Полоса над полем ввода:',
      `  приложение просило нарисовать: ${seen.bandCalls} раз`,
      `  плеер нарисован: ${seen.bandDrawn} раз`,
      `  последняя поверхность: ${seen.bandSurface}`,
      `  под плеером: ${seen.bandBelow}`,
      `  последний раз не рисовал, потому что: ${seen.bandSkipped}`,
      `  ошибка: ${seen.bandFailure}`,
      `  часы спрашивали время: ${seen.clockAsks} раз`,
      '',
      `Панель с кнопками нарисована: ${seen.panelDrawn} раз`,
      '',
      'Управление и время:',
      `  файл команд: ${commandFile ?? 'нет'}`,
      `  последняя команда: ${seen.lastCommand}`,
      `  ответ: ${seen.lastAnswer}`,
      `  ошибка: ${seen.controlFailure}`,
      `  время от Windows: ${timeline}`,
  ].join('\n')
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
  if (what === 'lyrics' && isOneOf(SWITCHES, value)) {
    await choose($, { lyrics: value })
    return value === 'on' ? `Текст песни: вкл. ${LYRICS_NOTE}` : 'Текст песни: выкл.'
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
      argumentHint: '[next|pause|play|prev|top|size|bottom|buttons|time|lyrics|off|on|debug|bug]',
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

    if (words[0] === 'debug') return { text: await debugText($) }
    if (words[0] === 'bug') {
      // The user's folder names them; a report is public.
      const report = (await debugText($)).replace(/[A-Za-z]:\\Users\\[^\\]+/g, '%USERPROFILE%')
      return { text: `${BUG_INTRO}\n${ISSUES}/new?template=bug.yml\n\n${report}` }
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

    const [chosen, playing, failure, listed] = await Promise.all([
      read($, settings),
      read($, track),
      read($, error),
      read($, sources),
    ])
    const { Box, Button, Link, Text } = $.ui.resolve(e)
    // The apps playing now, and the hidden ones so they can come back.
    const apps = [...new Set([...listed.map(one => one.app), ...chosen.hidden])]

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
        <Box flexDirection="column">
          {row('Текст песни вместо названия', 'lyrics', SWITCHES, SWITCH_LABELS, chosen.lyrics)}
          <Text dimColor size="caption">
            {LYRICS_NOTE}
          </Text>
        </Box>
        {apps.length === 0 ? null : (
          <Box flexDirection="column">
            <Text dimColor>Источники: выделенные показываются, нажми, чтобы скрыть или вернуть</Text>
            <Box flexDirection="row" gap="xs" flexWrap="wrap">
              {apps.map(app => {
                const one = listed.find(source => source.app === app)
                return (
                  <Button
                    key={`source-${app}`}
                    label={one === undefined ? appName(app) : `${appName(app)}: ${clip(one.text, SOURCE_MAX)}`}
                    variant={chosen.hidden.includes(app) ? 'secondary' : 'primary'}
                    onPress={() => void toggleSource($, app)}
                  />
                )
              })}
            </Box>
          </Box>
        )}
        <Box flexDirection="row" gap="sm">
          <Link href={`${ISSUES}/new?template=bug.yml`} label="Сообщить о баге" />
          <Link href={`${ISSUES}/new?template=question.yml`} label="Вопрос или идея" />
        </Box>
      </Box>
    )
  })

  // The band's clock and lyrics ask for the time; the answer is their next props.
  on('ui.message', async ($, e, next) => {
    if (e.element !== 'clock' && e.element !== 'lyrics') return next(e)
    const [chosen, playing, sung] = await Promise.all([read($, settings), read($, track), read($, lyrics)])
    if (playing === null) return next(e)
    const [at, size] = [await $.clock.now(), TEXT_SIZE[chosen.size]]

    if (e.element === 'lyrics') {
      const lines = linesFor(chosen, playing, sung)
      return lines === undefined ? next(e) : { props: lyricsProps(playing, lines, at, size) }
    }
    seen.clockAsks += 1
    const time = timeText(playing, at)
    return time === undefined ? next(e) : { props: { time, size } }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    seen.bandCalls += 1
    seen.bandSurface = e.surface
    // Where the surface runs the live parts (equalizer, clock) itself, the band
    // reads no clock: it is drawn again only when the track, its state or a
    // setting changes, and a button under the pointer stays as it is.
    const isLive = LIVE_SURFACES.includes(e.surface)
    const [chosen, playing, at, sung] = await Promise.all([
      read($, settings),
      read($, track),
      isLive ? $.clock.now() : read($, now),
      read($, lyrics),
    ])
    // Whatever other plugins put in the band stays; the player goes under it.
    const others = await next(e)
    seen.bandBelow = describe(others)

    if (e.props.hasSurvey || playing === null || chosen.top === 'off') {
      seen.bandSkipped = e.props.hasSurvey ? 'там опрос' : playing === null ? 'ничего не играет' : 'выключена'
      return others
    }

    try {
      const table = $.ui.resolve(e)
      const { Box, Button, Text } = table
      const Client = isLive && 'Client' in table ? table.Client : undefined
      const size = TEXT_SIZE[chosen.size]
      const time = chosen.time === 'on' ? timeText(playing, at) : undefined
      const lines = linesFor(chosen, playing, sung)
      const controls =
        chosen.controls === 'on' ? (
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
        ) : null
      // The buttons sit at the edge the band leans to, where a title or time
      // of another width cannot move them.
      const isControlsLast = chosen.top === 'right'
      const player = (
        <Box key="player" flexDirection="row" alignItems="center" gap="sm" justifyContent={JUSTIFY[chosen.top]}>
          {isControlsLast ? null : controls}
          {Client === undefined ? (
            <Text size={size} dimColor={!playing.isPlaying} mono>
              {equalizer(playing, at)}
            </Text>
          ) : (
            <Client key="equalizer" module="./equalizer.tsx" props={{ isPlaying: playing.isPlaying, size }} />
          )}
          {lines === undefined ? (
            <Text size={size} dimColor={!playing.isPlaying} wrap="truncate-end">
              {trackText(playing)}
            </Text>
          ) : Client === undefined ? (
            <Text size={size} dimColor={!playing.isPlaying} wrap="truncate-end">
              {(reveal(lines, positionAt(playing, at)) ?? [{ text: trackText(playing) }]).map(word => word.text).join('')}
            </Text>
          ) : (
            <Client
              key="lyrics"
              module="./lyrics.tsx"
              width={Math.max(LYRICS_MIN, Math.min(LYRICS_MAX, e.props.bodyColumns - BAND_OTHERS))}
              props={lyricsProps(playing, lines, at, size)}
            />
          )}
          {time === undefined ? null : Client === undefined ? (
            <Text size={size} dimColor tabular>
              {time}
            </Text>
          ) : (
            <Client key="clock" module="./clock.tsx" props={{ time, size }} />
          )}
          {isControlsLast ? controls : null}
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
