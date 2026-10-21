// Listening statistics: how long each track played, by day, kept in the
// plugin's store on this computer. Counted here alone: no model, no network.

// One track's listening on one day.
export type Listened = { artist: string; title: string; seconds: number; plays: number }

// Days by their local date, YYYY-MM-DD; each day's tracks by artist and title.
export type Stats = { v: 1; days: Record<string, Record<string, Listened>> }

// One line of a top list: who or what, how long, how many times started.
export type Ranked = { name: string; seconds: number; plays: number }

export type Report = {
  today: { seconds: number; tracks: number }
  week: { seconds: number; tracks: number }
  artists: Ranked[]
  tracks: Ranked[]
}

const DAY_MS = 86_400_000
// How many days are kept, and how many make the week.
export const KEPT_DAYS = 31
const WEEK_DAYS = 7
const TOP = 5

export const emptyStats = (): Stats => ({ v: 1, days: {} })

// Takes what the store holds, whatever it is, as stats; empty when it is none.
export const readStats = (saved: unknown): Stats => {
  if (saved === null || typeof saved !== 'object') return emptyStats()
  const { v, days } = saved as Partial<Stats>
  return v === 1 && days !== null && typeof days === 'object' ? { v, days } : emptyStats()
}

export const dayOf = (at: number): string => {
  const date = new Date(at)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const trackKey = (artist: string, title: string): string => `${artist}\n${title}`

// Adds `seconds` of a track to the day of `at`; `isStart` counts one more play.
export const addListening = (
  stats: Stats,
  at: number,
  one: { artist: string; title: string },
  seconds: number,
  isStart: boolean,
): void => {
  const day = (stats.days[dayOf(at)] ??= {})
  const key = trackKey(one.artist, one.title)
  const listened = (day[key] ??= { artist: one.artist, title: one.title, seconds: 0, plays: 0 })
  listened.seconds += seconds
  if (isStart) listened.plays += 1
}

// Drops the days older than KEPT_DAYS before `at`.
export const pruneStats = (stats: Stats, at: number): void => {
  const oldest = dayOf(at - (KEPT_DAYS - 1) * DAY_MS)
  for (const day of Object.keys(stats.days)) if (day < oldest) delete stats.days[day]
}

const ranked = (totals: Map<string, Ranked>): Ranked[] =>
  [...totals.values()].sort((a, b) => b.seconds - a.seconds || b.plays - a.plays).slice(0, TOP)

// Today's and the last seven days' totals, and the week's top artists and tracks.
export const reportOf = (stats: Stats, at: number): Report => {
  const todayKey = dayOf(at)
  const weekKeys = new Set(Array.from({ length: WEEK_DAYS }, (_, back) => dayOf(at - back * DAY_MS)))
  const artists = new Map<string, Ranked>()
  const tracks = new Map<string, Ranked>()
  const report: Report = { today: { seconds: 0, tracks: 0 }, week: { seconds: 0, tracks: 0 }, artists: [], tracks: [] }

  for (const [day, listened] of Object.entries(stats.days)) {
    if (!weekKeys.has(day)) continue
    for (const one of Object.values(listened)) {
      if (day === todayKey) {
        report.today.seconds += one.seconds
        report.today.tracks += 1
      }
      report.week.seconds += one.seconds
      const artist = one.artist === '' ? 'без исполнителя' : one.artist
      const name = one.artist === '' ? one.title : `${one.artist} — ${one.title}`
      const byArtist = artists.get(artist) ?? { name: artist, seconds: 0, plays: 0 }
      artists.set(artist, { ...byArtist, seconds: byArtist.seconds + one.seconds, plays: byArtist.plays + one.plays })
      const byTrack = tracks.get(name) ?? { name, seconds: 0, plays: 0 }
      tracks.set(name, { ...byTrack, seconds: byTrack.seconds + one.seconds, plays: byTrack.plays + one.plays })
    }
  }
  report.week.tracks = tracks.size
  report.artists = ranked(artists)
  report.tracks = ranked(tracks)
  return report
}

// "45 с", "12 мин", "3 ч 5 мин".
export const durationText = (seconds: number): string => {
  const whole = Math.floor(seconds)
  if (whole < 60) return `${whole} с`
  const minutes = Math.floor(whole / 60)
  return minutes < 60 ? `${minutes} мин` : `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`
}

export const BAR_CELLS = 12

// A bar of BAR_CELLS cells for `value` against the longest, split into what
// it fills and what it leaves: at least one cell for anything above nothing.
export const barCells = (value: number, longest: number): [number, number] => {
  const filled = longest <= 0 ? 0 : Math.max(value > 0 ? 1 : 0, Math.round((value / longest) * BAR_CELLS))
  return [filled, BAR_CELLS - filled]
}

const rankedLines = (title: string, list: readonly Ranked[], withPlays: boolean): string[] => {
  const longest = list[0]?.seconds ?? 0
  return list.length === 0
    ? []
    : [
        '',
        title,
        ...list.map(one => {
          const [filled, left] = barCells(one.seconds, longest)
          const plays = withPlays && one.plays > 0 ? `, раз: ${one.plays}` : ''
          return `${'█'.repeat(filled)}${'░'.repeat(left)} ${one.name} · ${durationText(one.seconds)}${plays}`
        }),
      ]
}

export const STATS_TITLE = 'Статистика. Считается только у тебя на компьютере, токены не тратит.'

// The report in words, for /player stats where no panel is drawn.
export const reportText = (report: Report): string =>
  report.week.seconds === 0
    ? `${STATS_TITLE}\n\nПока пусто: статистика копится, пока играет музыка.`
    : [
        STATS_TITLE,
        '',
        `Сегодня: ${durationText(report.today.seconds)}, треков: ${report.today.tracks}`,
        `За неделю: ${durationText(report.week.seconds)}, треков: ${report.week.tracks}`,
        ...rankedLines('Исполнители за неделю', report.artists, false),
        ...rankedLines('Треки за неделю', report.tracks, true),
      ].join('\n')
