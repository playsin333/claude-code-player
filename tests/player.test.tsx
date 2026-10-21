import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { MockClock } from 'claude-code/testing'

import { dayOf } from '../hooks/stats'

const BAND = {
  plugin: 'now-playing',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

const PANEL = {
  plugin: 'now-playing',
  component: 'CommandOutput',
  props: { command: 'player', args: '', text: '', isErrored: false },
} as const

const run = (args: string) => ({
  command: 'player',
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: false, columns: 80 },
})

// The helper's report of these sessions, the first one current in Windows.
const report = (...sessions: object[]): string =>
  `${JSON.stringify({ sessions: sessions.map((one, at) => ({ isCurrent: at === 0, ...one })) })}\r\n`

const line = (track: object): string => report(track)

const EQUALIZER = { type: 'Text', text: /^[▁▂▃▅▆▇]{3}$/ } as const

const GYM_CLASS = line({ app: 'Spotify.exe', artist: 'Lil Peep', title: 'Gym Class', isPlaying: true })

const COMMAND_FILE = '/tmp/now-playing-1.cmd'
const COMMANDS = `${JSON.stringify({ commands: COMMAND_FILE })}\r\n`

// A minute into a 3:45 track, as Windows reported it at `at`.
const TIME = { type: 'Text', text: /\d:\d\d \/ / } as const

// The live parts the band hands the surface to run: the equalizer and the clock.
const LIVE_EQUALIZER = { ...EQUALIZER, in: 'equalizer' } as const
const LIVE_TIME = { ...TIME, in: 'clock' } as const

const timed = (at: number, isPlaying = true): string =>
  line({ app: 'Spotify.exe', artist: 'Lil Peep', title: 'Gym Class', isPlaying, position: 60, duration: 225, updatedAt: at })

// Stands for the engine beneath the plugin: a helper that prints `lines`,
// waiting where a line is a number of milliseconds, then stays alive until
// the clock passes a minute.
const start = async (
  on: On,
  lines: (string | number)[],
  clock: MockClock,
  stored: Record<string, unknown> = {},
): Promise<string[]> => {
  const statuses: string[] = []
  mock.store(on, stored)
  on('command.register', () => ({ value: { command: 'player' } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.surfaces', () => ({ value: ['desktop'] as const }))
  on('ui.status', (_, e) => {
    statuses.push(e.text ?? '')
    return { value: undefined }
  })
  on('process.spawn', async function* () {
    for (const text of lines) {
      if (typeof text === 'number') await clock.sleep(text)
      else yield { stream: 'stdout' as const, text }
    }
    await clock.sleep(60_000)
    return { value: { code: 0, signal: null } }
  })
  // The engine's own drawing, a stand-in beneath the plugin.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  return statuses
}

test('the band shows the cleaned track, small and centered by default', async ($, on) => {
  const clock = mock.clock(on)
  await start(
    on,
    [line({ app: 'chrome.exe', artist: '', title: 'Lil Peep - Gym Class (Official Video)', isPlaying: true })],
    clock,
  )
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const text = await ui.find({ type: 'Text', text: /Gym Class/ })
  expect(text?.text).toBe('Lil Peep — Gym Class')
  expect(text?.props.size).toBe('caption')
  expect((await ui.find(LIVE_EQUALIZER))?.text).toBe('▂▅▃')
  expect((await ui.find(LIVE_EQUALIZER))?.props.mono).toBe(true)
  expect((await ui.find({ key: 'player' }))?.props.justifyContent).toBe('center')
  await ui.unmount()
})

test('the band keeps what other plugins draw there', async ($, on) => {
  const clock = mock.clock(on)
  await start(on, [GYM_CLASS], clock)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  expect((await ui.find({ type: 'Text', text: /Gym Class/ }))?.text).toBe('Lil Peep — Gym Class')
  await ui.unmount()
})

test('a JSON line split across pieces is still read', async ($, on) => {
  const clock = mock.clock(on)
  const whole = line({ app: 'Spotify.exe', artist: 'Скриптонит', title: 'Положение', isPlaying: false })
  await start(on, [whole.slice(0, 20), whole.slice(20)], clock)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Положение/ }))?.text).toBe('Скриптонит — Положение')
  expect((await ui.find(LIVE_EQUALIZER))?.text).toBe('▁▁▁')
  await ui.unmount()
})

test('/player top and size move and resize the band', async ($, on) => {
  const clock = mock.clock(on)
  await start(on, [GYM_CLASS], clock)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()

  expect((await $.command.run(run('top right'))).text).toContain('справа')
  expect((await $.command.run(run('size normal'))).text).toContain('обычный')

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ key: 'player' }))?.props.justifyContent).toBe('flex-end')
  expect((await ui.find({ type: 'Text', text: /Gym Class/ }))?.props.size).toBe('body')
  await ui.unmount()

  await $.command.run(run('top off'))
  const hidden = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await hidden.find({ type: 'Text', text: /Gym Class/ })).toBeUndefined()
  await hidden.unmount()
})

test('/player bottom turns the line beside the model off and on', async ($, on) => {
  const clock = mock.clock(on)
  const statuses = await start(on, [GYM_CLASS], clock)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()
  expect(statuses.at(-1)).toContain('Lil Peep — Gym Class')

  expect((await $.command.run(run('bottom off'))).text).toBe('Строчка внизу: выкл.')
  expect(statuses.at(-1)).toBe('')

  expect((await $.command.run(run('bottom on'))).text).toBe('Строчка внизу: вкл.')
  expect(statuses.at(-1)).toContain('Lil Peep — Gym Class')
})

test('a bottom line saved beside Auto moves beside the model', async ($, on) => {
  const clock = mock.clock(on)
  const statuses = await start(on, [GYM_CLASS], clock, { settings: { top: 'left', size: 'normal', bottom: 'auto' } })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()

  expect(statuses.at(-1)).toContain('Lil Peep — Gym Class')
  expect((await $.command.run(run(''))).text).toContain('Над полем: слева · Размер: обычный · Внизу: вкл')
})

test('the /player panel changes settings with its buttons', async ($, on) => {
  const clock = mock.clock(on)
  await start(on, [GYM_CLASS], clock)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()

  const panel = await $.ui.mount({ ...PANEL, surface: 'desktop' })
  expect((await panel.find({ type: 'Text', text: /Играет/ }))?.text).toBe('Играет: Lil Peep — Gym Class (Spotify)')
  expect((await panel.find({ key: 'top-center' }))?.props.variant).toBe('primary')
  await panel.press({ key: 'top-left' })
  expect((await panel.find({ key: 'top-left' }))?.props.variant).toBe('primary')
  await panel.unmount()

  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await band.find({ key: 'player' }))?.props.justifyContent).toBe('flex-start')
  await band.unmount()
})

test('settings saved by 1.0 carry over', async ($, on) => {
  const clock = mock.clock(on)
  await start(on, [GYM_CLASS], clock, { mode: 'line' })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Gym Class/ })).toBeUndefined()
  await ui.unmount()

  expect((await $.command.run(run(''))).text).toContain('Над полем: выкл · Размер: маленький · Внизу: вкл')
})

test('/player off hides everything and /player on brings it back', async ($, on) => {
  const clock = mock.clock(on)
  const statuses = await start(on, [GYM_CLASS], clock)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()

  await $.command.run(run('off'))
  expect(statuses.at(-1)).toBe('')
  const hidden = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await hidden.find({ type: 'Text', text: /Gym Class/ })).toBeUndefined()
  await hidden.unmount()

  await $.command.run(run('on'))
  expect(statuses.at(-1)).toContain('Lil Peep — Gym Class')
})

test('/player debug reports what the drawings saw', async ($, on) => {
  const clock = mock.clock(on)
  await start(on, [GYM_CLASS], clock)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.unmount()

  const answer = await $.command.run(run('debug'))
  expect(answer.text).toContain('now-playing 1.8.0')
  expect(answer.text).toContain('Играет: Lil Peep — Gym Class')
  expect(answer.text).toMatch(/плеер нарисован: [1-9]/)
  expect(answer.text).toContain('последняя поверхность: desktop')
  expect(answer.text).toContain('Поверхности сессии: desktop')
})

test('apps get readable names', async ($, on) => {
  const clock = mock.clock(on)
  await start(
    on,
    [line({ app: 'Chrome._crx_eikjhbkpemcmdeeeamdpkgabmk', artist: 'Lil Peep', title: 'Gym Class', isPlaying: true })],
    clock,
  )
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()

  expect((await $.command.run(run(''))).text).toContain('Играет: Lil Peep — Gym Class (приложение Chrome)')
  expect((await $.command.run(run('debug'))).text).toContain('Windows: Chrome._crx_eikjhbkpemcmdeeeamdpkgabmk')
})

test('an unknown /player word gets the help', async ($, on) => {
  const clock = mock.clock(on)
  await start(on, [GYM_CLASS], clock)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()

  const answer = await $.command.run(run('top sideways'))
  expect(answer.text).toContain('Не знаю «top sideways»')
  expect(answer.text).toContain('/player top off|left|center|right')
})

test('/player says when the helper ends without a word', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  on('command.register', () => ({ value: { command: 'player' } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('ui.status', () => ({ value: undefined }))
  on('process.spawn', async function* () {
    yield { stream: 'stderr' as const, text: 'powershell.exe: not found' }
    return { value: { code: 1, signal: null } }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.settle()

  const answer = await $.command.run(run(''))
  expect(answer.text).toContain('только на Windows')
  expect(answer.text).toContain('powershell.exe: not found')
  expect((await $.command.run(run('next'))).text).toContain('Ошибка: помощник не запустился')
})

test('the band shows the buttons and a time that runs while the track plays', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const statuses = await start(on, [COMMANDS, timed(1_000_000)], clock)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find(LIVE_TIME))?.text).toBe('1:00 / 3:45')
  expect((await ui.find({ key: 'previous' }))?.props.label).toBe('⏮\uFE0E')
  expect((await ui.find({ key: 'toggle' }))?.props.label).toBe('⏸\uFE0E')
  expect((await ui.find({ key: 'next' }))?.props.label).toBe('⏭\uFE0E')

  // The clock asks for the time on the surface's own frame clock.
  await clock.advance(5_100)
  await ui.advance(500)
  expect((await ui.find(LIVE_TIME))?.text).toBe('1:05 / 3:45')
  expect(statuses.at(-1)).toContain('Lil Peep — Gym Class  1:05 / 3:45')
  await ui.unmount()
})

test('a paused track keeps its time and offers play', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  await start(on, [COMMANDS, timed(990_000, false)], clock)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()
  await clock.advance(5_000)

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find(LIVE_TIME))?.text).toBe('1:00 / 3:45')
  expect((await ui.find({ key: 'toggle' }))?.props.label).toBe('▶\uFE0E')
  await ui.unmount()
})

test('the buttons and /player words hand presses to the helper', async ($, on) => {
  const clock = mock.clock(on)
  await start(on, [COMMANDS, GYM_CLASS], clock)
  const writes: { path: string; text: string }[] = []
  on('fs.write', (_$, e) => {
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()

  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await band.press({ key: 'next' })
  await band.unmount()

  const panel = await $.ui.mount({ ...PANEL, surface: 'desktop' })
  expect((await panel.find({ key: 'panel-toggle' }))?.props.label).toBe('⏸\uFE0E пауза')
  await panel.press({ key: 'panel-toggle' })
  await panel.unmount()

  expect((await $.command.run(run('prev'))).text).toBe('Предыдущий трек.')
  expect((await $.command.run(run('pause'))).text).toBe('Пауза.')
  const presses = writes.map(write => JSON.parse(write.text) as { command: string; app: string; title: string })
  expect(presses.map(one => one.command)).toEqual(['next', 'toggle', 'previous', 'pause'])
  expect(presses.every(one => one.app === 'Spotify.exe' && one.title === 'Gym Class')).toBe(true)
  expect(writes.every(write => write.path === COMMAND_FILE)).toBe(true)
  expect((await $.command.run(run('debug'))).text).toContain('последняя команда: pause')
})

test('/player buttons and time turn them off', async ($, on) => {
  const clock = mock.clock(on)
  const statuses = await start(on, [COMMANDS, timed(0)], clock)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()

  expect((await $.command.run(run('buttons off'))).text).toBe('Кнопки: выкл.')
  expect((await $.command.run(run('time off'))).text).toBe('Время трека: выкл.')
  expect(statuses.at(-1)).toBe('▂▅▃  Lil Peep — Gym Class')

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ key: 'next' })).toBeUndefined()
  expect(await ui.find({ key: 'clock' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /Gym Class/ }))?.text).toBe('Lil Peep — Gym Class')
  await ui.unmount()

  const panel = await $.ui.mount({ ...PANEL, surface: 'desktop' })
  expect((await panel.find({ key: 'controls-off' }))?.props.variant).toBe('primary')
  await panel.press({ key: 'time-on' })
  await panel.unmount()
  expect(statuses.at(-1)).toBe('▂▅▃  Lil Peep — Gym Class  1:00 / 3:45')
})

test('the band draws its buttons and time in the terminal too', async ($, on) => {
  const clock = mock.clock(on)
  await start(on, [COMMANDS, timed(0)], clock)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.settle()

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /Gym Class/ }))?.text).toBe('Lil Peep — Gym Class')
  expect((await ui.find(LIVE_TIME))?.text).toBe('1:00 / 3:45')
  expect((await ui.find({ key: 'next' }))?.props.plain).toBe(true)
  await ui.unmount()
})

const MUSIC = { app: 'Chrome._crx_music', artist: 'Lil Peep', title: 'dying out west', duration: 152 }
const SERIES = { app: 'Chrome', artist: '', title: 'Серия 3', duration: 2700 }

test('with the music paused, play goes back to it and not to a paused series', async ($, on) => {
  const clock = mock.clock(on)
  const series = { ...SERIES, isPlaying: false, isCurrent: true }
  await start(
    on,
    [COMMANDS, report(series, { ...MUSIC, isPlaying: true }), 1_000, report(series, { ...MUSIC, isPlaying: false })],
    clock,
  )
  const writes: string[] = []
  on('fs.write', (_$, e) => {
    writes.push(e.text)
    return { value: undefined }
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()
  await clock.advance(1_000)

  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await band.find({ type: 'Text', text: /Lil Peep/ }))?.text).toBe('Lil Peep — dying out west')
  expect((await band.find({ key: 'toggle' }))?.props.label).toBe('▶\uFE0E')
  await band.press({ key: 'toggle' })
  await band.unmount()

  expect(JSON.parse(writes.at(-1) ?? '{}')).toEqual({ command: 'toggle', app: MUSIC.app, title: MUSIC.title })
  expect((await $.command.run(run('debug'))).text).toContain('приложение Chrome (Chrome._crx_music), пауза, показана')
})

test('a hidden source is never shown, and comes back from the panel', async ($, on) => {
  const clock = mock.clock(on)
  const statuses = await start(
    on,
    [COMMANDS, report({ ...SERIES, isPlaying: true }, { ...MUSIC, isPlaying: false })],
    clock,
  )
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()
  expect(statuses.at(-1)).toContain('Серия 3')

  const panel = await $.ui.mount({ ...PANEL, surface: 'desktop' })
  expect((await panel.find({ key: 'source-Chrome' }))?.props.label).toBe('Chrome: Серия 3')
  await panel.press({ key: 'source-Chrome' })
  expect((await panel.find({ key: 'source-Chrome' }))?.props.variant).toBe('secondary')
  expect(statuses.at(-1)).toContain('Lil Peep — dying out west')
  expect((await $.command.run(run('debug'))).text).toContain('Скрытые источники: Chrome')

  await panel.press({ key: 'source-Chrome' })
  expect((await panel.find({ key: 'source-Chrome' }))?.props.variant).toBe('primary')
  expect(statuses.at(-1)).toContain('Серия 3')
  await panel.unmount()
})

test('hidden sources are remembered', async ($, on) => {
  const clock = mock.clock(on)
  const statuses = await start(
    on,
    [COMMANDS, report({ ...SERIES, isPlaying: true }, { ...MUSIC, isPlaying: true })],
    clock,
    { settings: { top: 'center', size: 'small', bottom: 'model', hidden: ['Chrome'] } },
  )
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()

  expect(statuses.at(-1)).toContain('Lil Peep — dying out west')
  expect((await $.command.run(run(''))).text).toContain('Кнопки: вкл · Время: вкл')
})

test('on the right the buttons sit at the edge, after the time', async ($, on) => {
  const clock = mock.clock(on)
  await start(on, [COMMANDS, timed(0)], clock, { settings: { top: 'right', size: 'small', bottom: 'model' } })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const player = await ui.find({ key: 'player' })
  expect((player?.children.at(-1) as { props?: { key?: string } } | undefined)?.props?.key).toBe('controls')
  await ui.unmount()

  await $.command.run(run('top left'))
  const left = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(((await left.find({ key: 'player' }))?.children[0] as { props?: { key?: string } } | undefined)?.props?.key).toBe(
    'controls',
  )
  await left.unmount()
})

test('while the track plays the band is not drawn again, only when it changes', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const at = (position: number, updatedAt: number): string =>
    line({ app: 'Spotify.exe', artist: 'Lil Peep', title: 'Gym Class', isPlaying: true, position, duration: 225, updatedAt })
  // A report a second later that keeps time, then a seek to two minutes.
  await start(on, [COMMANDS, at(60, 1_000_000), 1_000, at(61, 1_001_000), 1_000, at(120, 1_002_000)], clock)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()
  const drawn = async (): Promise<number> =>
    Number(((await $.command.run(run("debug"))).text ?? "").match(/плеер нарисован: (\d+)/)?.[1])

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const first = await drawn()
  expect((await ui.find(LIVE_EQUALIZER))?.text).toBe('▂▅▃')

  await clock.advance(1_500)
  await ui.advance(600)
  expect(await drawn()).toBe(first)
  expect((await ui.find(LIVE_EQUALIZER))?.text).toBe('▃▇▂')
  expect((await ui.find(LIVE_TIME))?.text).toBe('1:01 / 3:45')

  await clock.advance(1_000)
  await ui.advance(500)
  expect(await drawn()).toBeGreaterThan(first)
  expect((await ui.find(LIVE_TIME))?.text).toBe('2:00 / 3:45')
  expect((await $.command.run(run('debug'))).text).toMatch(/часы спрашивали время: [1-9]/)
  await ui.unmount()
})

test('a surface that runs no live parts draws the equalizer and time itself', async ($, on) => {
  const clock = mock.clock(on)
  await start(on, [COMMANDS, timed(0)], clock)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()

  const ui = await $.ui.mount({ ...BAND, surface: 'vscode' })
  expect((await ui.find(EQUALIZER))?.text).toBe('▂▅▃')
  expect((await ui.find(TIME))?.text).toBe('1:00 / 3:45')
  expect(await ui.find({ key: 'clock' })).toBeUndefined()
  await ui.unmount()
})

// Lyrics as LRCLIB keeps them: a tag, two sung lines and a break between.
const LRC = ['[ar:Lil Peep]', '[00:10.00]раз два три', '[00:12.00]', '[00:20.00]четыре пять'].join('\n')

// Stands for lrclib.net: answers every search with `hits`, noting each address.
const lrclib = (on: On, hits: object[]): string[] => {
  const asked: string[] = []
  on('http.fetch', (_$, e) => {
    asked.push(e.url)
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(hits) } }
  })
  return asked
}

const LYRICS_ON = { settings: { top: 'center', size: 'small', bottom: 'model', lyrics: 'on' } }

// Moves the engine's clock and the surface's frame clock on together, as they go.
const both = async (clock: MockClock, ui: { advance: (ms: number) => Promise<void> }, ms: number): Promise<void> => {
  await clock.advance(ms)
  await ui.advance(ms)
}

test('lyrics stay off until asked for, and nothing is searched', async ($, on) => {
  const clock = mock.clock(on)
  const asked = lrclib(on, [{ duration: 225, syncedLyrics: LRC }])
  await start(on, [COMMANDS, timed(0)], clock)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Gym Class/ }))?.text).toBe('Lil Peep — Gym Class')
  expect(await ui.find({ key: 'lyrics' })).toBeUndefined()
  await ui.unmount()
  expect(asked).toEqual([])
  expect((await $.command.run(run('debug'))).text).toContain('Текст песни: выкл')
})

test('with lyrics on, a line comes in word by word as it is sung', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  lrclib(on, [{ duration: 225, syncedLyrics: LRC }])
  const eight = line({ app: 'Spotify.exe', artist: 'Lil Peep', title: 'Gym Class', isPlaying: true, position: 8, duration: 225, updatedAt: 1_000_000 })
  await start(on, [COMMANDS, eight], clock, LYRICS_ON)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()
  expect((await $.command.run(run('debug'))).text).toContain('Текст песни: найден, строк: 3')

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  // Each word in view: · when it is dim, * when it is in the palette's color.
  const words = async (): Promise<string[]> =>
    (await ui.findAll({ type: 'Text', in: 'lyrics' }))
      .slice(1)
      .map(word => `${word.text.trim()}${word.props.dimColor ? '·' : ''}${word.props.color ? '*' : ''}`)
  // Before the first line, the title.
  expect((await ui.find({ type: 'Text', in: 'lyrics' }))?.text).toBe('Lil Peep — Gym Class')

  // The word being sung is in the palette's color, Claude's by default.
  await both(clock, ui, 2_000)
  expect(await words()).toEqual(['раз*'])
  expect((await ui.findAll({ type: 'Text', in: 'lyrics' }))[1]?.props.color).toBe('#d97757')
  // A line longer than its room keeps the newest words in view.
  expect((await ui.find({ type: 'Text', in: 'lyrics' }))?.props.wrap).toBe('truncate-start')
  await both(clock, ui, 500)
  expect(await words()).toEqual(['раз', 'два*'])
  await both(clock, ui, 500)
  expect(await words()).toEqual(['раз', 'два', 'три*'])

  // The break between lines shows the title again, then the next line comes in.
  await both(clock, ui, 1_000)
  expect((await ui.find({ type: 'Text', in: 'lyrics' }))?.text).toBe('Lil Peep — Gym Class')
  await both(clock, ui, 8_000)
  expect(await words()).toEqual(['четыре*'])
  await ui.unmount()
})

test('a paused track holds its line where it is', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  lrclib(on, [{ duration: 225, syncedLyrics: LRC }])
  const paused = line({ app: 'Spotify.exe', artist: 'Lil Peep', title: 'Gym Class', isPlaying: false, position: 10.5, duration: 225, updatedAt: 1_000_000 })
  await start(on, [COMMANDS, paused], clock, LYRICS_ON)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const shown = async (): Promise<string> => (await ui.find({ type: 'Text', in: 'lyrics' }))?.text ?? ''
  const before = await shown()
  await both(clock, ui, 3_000)
  expect(await shown()).toBe(before)
  expect((await ui.findAll({ type: 'Text', in: 'lyrics' })).map(word => word.text.trim())).toContain('два')
  await ui.unmount()
})

test('lyrics are searched without tags and decoration, and a miss keeps the title', async ($, on) => {
  const clock = mock.clock(on)
  const asked = lrclib(on, [{ duration: 225, syncedLyrics: null }])
  await start(
    on,
    [COMMANDS, line({ app: 'Chrome', artist: '☆LiL PEEP☆', title: 'falling 4 me (prod. lederrick x horse head)', isPlaying: true })],
    clock,
    LYRICS_ON,
  )
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()

  const first = new URL(asked[0] ?? 'https://lrclib.net').searchParams
  expect(first.get('track_name')).toBe('falling 4 me')
  expect(first.get('artist_name')).toBe('LiL PEEP')
  expect(new URL(asked[1] ?? 'https://lrclib.net').searchParams.get('q')).toBe('LiL PEEP falling 4 me')
  expect((await $.command.run(run('debug'))).text).toContain('Текст песни: не найден на lrclib.net')

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ key: 'lyrics' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /falling 4 me/ }))?.text).toBe('☆LiL PEEP☆ — falling 4 me (prod. lederrick x horse head)')
  await ui.unmount()
})

test('/player lyrics turns them on and says where they come from', async ($, on) => {
  const clock = mock.clock(on)
  const asked = lrclib(on, [{ duration: 225, syncedLyrics: LRC }])
  await start(on, [COMMANDS, timed(0)], clock)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()

  expect((await $.command.run(run('lyrics on'))).text).toContain('lrclib.net')
  await clock.settle()
  expect(asked).toHaveLength(1)
  const panel = await $.ui.mount({ ...PANEL, surface: 'desktop' })
  expect((await panel.find({ key: 'lyrics-on' }))?.props.variant).toBe('primary')
  await panel.unmount()
})

test('lyrics of another version, far off in length, are not used', async ($, on) => {
  const clock = mock.clock(on)
  lrclib(on, [{ duration: 300, syncedLyrics: LRC }])
  await start(on, [COMMANDS, timed(0)], clock, LYRICS_ON)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()

  expect((await $.command.run(run('debug'))).text).toContain('Текст песни: не найден на lrclib.net')
})

test('a failed lyrics search is tried again a minute later, not on every report', async ($, on) => {
  const clock = mock.clock(on)
  let asks = 0
  on('http.fetch', () => {
    asks += 1
    return asks === 1
      ? { value: { status: 503, ok: false, headers: {}, text: '' } }
      : { value: { status: 200, ok: true, headers: {}, text: JSON.stringify([{ duration: 225, syncedLyrics: LRC }]) } }
  })
  await start(on, [COMMANDS, timed(0), 1_000, timed(0), 60_000, timed(0)], clock, LYRICS_ON)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()
  expect((await $.command.run(run('debug'))).text).toContain('Текст песни: ошибка (lrclib.net ответил 503)')

  await clock.advance(1_000)
  expect(asks).toBe(1)
  await clock.advance(60_000)
  expect(asks).toBe(2)
  expect((await $.command.run(run('debug'))).text).toContain('Текст песни: найден, строк: 3')
})

test('an app that reports no time keeps counting through reports about other apps', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const untimed = { app: 'Spotify.exe', artist: 'Lil Peep', title: 'Gym Class', isPlaying: true, position: 0, duration: 200, updatedAt: 0 }
  const statuses = await start(
    on,
    [COMMANDS, report(untimed), 5_000, report(untimed, { app: 'Chrome', artist: '', title: 'Серия 3', isPlaying: false })],
    clock,
  )
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()

  await clock.advance(5_100)
  expect(statuses.at(-1)).toContain('Lil Peep — Gym Class  0:05 / 3:20')
})

test('/player bug gives the form and a report without the user folder; the panel links both forms', async ($, on) => {
  const clock = mock.clock(on)
  const windowsFile = `${JSON.stringify({ commands: 'C:\\Users\\Петя\\AppData\\Local\\Temp\\now-playing-1.cmd' })}\r\n`
  await start(on, [windowsFile, GYM_CLASS], clock)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()

  const answer = (await $.command.run(run('bug'))).text ?? ''
  expect(answer).toContain('https://github.com/playsin333/claude-code-player/issues/new?template=bug.yml')
  expect(answer).toContain('now-playing 1.')
  expect(answer).toContain('файл команд: %USERPROFILE%\\AppData\\Local\\Temp\\now-playing-1.cmd')
  expect(answer).not.toContain('Петя')

  const panel = await $.ui.mount({ ...PANEL, surface: 'desktop' })
  const links = (await panel.findAll({ type: 'Link' })).map(link => String(link.props.href))
  expect(links).toEqual([
    'https://github.com/playsin333/claude-code-player/issues/new?template=bug.yml',
    'https://github.com/playsin333/claude-code-player/issues/new?template=question.yml',
  ])
  await panel.unmount()
})

// A reading of the output device's meter: overall, left, right.
const levels = (peak: number, left: number, right: number): string => `${JSON.stringify({ levels: [peak, left, right] })}\r\n`

test('the equalizer follows the sound while Windows reads its meter, and plays its frames without it', async ($, on) => {
  const clock = mock.clock(on)
  const statuses = await start(
    on,
    [COMMANDS, GYM_CLASS, levels(0.5, 0.5, 0.5), 100, levels(0.25, 0.1, 0.4), 100, levels(0, 0, 0)],
    clock,
  )
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const bars = async (): Promise<string | undefined> => (await ui.find({ type: 'Text', in: 'equalizer' }))?.text
  // Loud on every side: all three bars at the top.
  expect(await bars()).toBe('▇▇▇')
  expect((await $.command.run(run('debug'))).text).toMatch(/эквалайзер: живой/)

  // Quieter on the left now; the louder reading before stays in the other bars.
  await both(clock, ui, 100)
  expect(await bars()).toBe('▂▇▇')
  await both(clock, ui, 100)
  expect(await bars()).toBe('▁▅▇')
  await clock.advance(100)
  expect(statuses.at(-1)?.startsWith('▁▅▇')).toBe(true)

  // No readings for a while: the meter is gone, and the frames play again.
  await both(clock, ui, 2_500)
  expect(await bars()).toMatch(/^[▂▃▅▆▇]{3}$/)
  expect((await $.command.run(run('debug'))).text).toContain('эквалайзер: свои кадры')
  await ui.unmount()
})

// The colors the equalizer's bars are drawn in, left to right.
const barColors = async (ui: { findAll: (query: { type: string; in: string }) => Promise<{ props: Record<string, unknown> }[]> }) =>
  (await ui.findAll({ type: 'Text', in: 'equalizer' })).slice(1).map(bar => bar.props.color)

test('the equalizer takes the palette, Claude by default, and /player color changes it', async ($, on) => {
  const clock = mock.clock(on)
  await start(on, [COMMANDS, GYM_CLASS], clock)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await barColors(ui)).toEqual(['#eb9473', '#d97757', '#bf5f3d'])

  expect((await $.command.run(run('color neon'))).text).toBe('Цвет: Неон.')
  expect(await barColors(ui)).toEqual(['#ff5fd2', '#a178ff', '#3ddcff'])

  // Any color of one's own: three shades of it.
  expect((await $.command.run(run('color #5AB'))).text).toBe('Свой цвет: #55aabb.')
  expect(await barColors(ui)).toEqual(['#81c0cc', '#55aabb', '#3c8897'])

  expect((await $.command.run(run('color mono'))).text).toBe('Цвет: без цвета.')
  expect(await barColors(ui)).toEqual([])
  expect((await ui.find({ type: 'Text', in: 'equalizer' }))?.text).toBe('▂▅▃')

  expect((await $.command.run(run('color plaid'))).text).toContain('Не знаю «color plaid»')
  await ui.unmount()
})

test('RGB runs the bars around a color wheel', async ($, on) => {
  const clock = mock.clock(on)
  await start(on, [COMMANDS, GYM_CLASS], clock, { settings: { top: 'center', size: 'small', bottom: 'model', palette: 'rgb' } })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await barColors(ui)).toEqual(['#f04c4c', '#baf04c', '#4cf0ba'])
  await ui.advance(100)
  expect(await barColors(ui)).toEqual(['#f0674c', '#9ef04c', '#4cf0d5'])
  await ui.unmount()
})

test('the panel picks a color of one\'s own from its strips', async ($, on) => {
  const clock = mock.clock(on)
  await start(on, [COMMANDS, GYM_CLASS], clock)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()

  const panel = await $.ui.mount({ ...PANEL, surface: 'desktop' })
  expect((await panel.find({ key: 'palette-claude' }))?.props.variant).toBe('primary')
  expect(await panel.find({ key: 'picker' })).toBeUndefined()
  await panel.press({ key: 'palette-custom' })
  expect(await panel.find({ key: 'picker' })).toBeDefined()

  // Top strip: every hue; the first cell is red.
  await panel.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'picker' })
  expect((await $.command.run(run(''))).text).toContain('Цвет: свой #f04242')
  // Bottom strip: that red from dark to light; the last cell is the lightest.
  await panel.pointer({ type: 'down', x: 35, y: 1, button: 'left', in: 'picker' })
  expect((await $.command.run(run(''))).text).toContain('Цвет: свой #f9b8b8')

  // A post that names no color of the strips changes nothing.
  await panel.post({ strip: 'hue', index: 999 }, { in: 'picker' })
  await panel.post({ strip: 'paint', index: 1 }, { in: 'picker' })
  expect((await $.command.run(run(''))).text).toContain('Цвет: свой #f9b8b8')
  await panel.unmount()

  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await barColors(band))[1]).toBe('#f9b8b8')
  await band.unmount()
})

test('a surface without the picker says how to set a color in words', async ($, on) => {
  const clock = mock.clock(on)
  await start(on, [COMMANDS, GYM_CLASS], clock, { settings: { top: 'center', size: 'small', bottom: 'model', palette: 'custom', color: '#5ab0ff' } })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()

  const panel = await $.ui.mount({ ...PANEL, surface: 'vscode' })
  expect(await panel.find({ key: 'picker' })).toBeUndefined()
  expect((await panel.find({ type: 'Text', text: /\/player color #rrggbb/ }))?.text).toContain('#5ab0ff')
  await panel.unmount()
})

test('the panel with its palettes and picker draws in the terminal too', async ($, on) => {
  const clock = mock.clock(on)
  await start(on, [COMMANDS, GYM_CLASS], clock, { settings: { top: 'center', size: 'small', bottom: 'model', palette: 'custom', color: '#5ab0ff' } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.settle()

  const panel = await $.ui.mount({ ...PANEL, surface: 'terminal' })
  expect((await panel.find({ key: 'palette-custom' }))?.props.variant).toBe('primary')
  expect(await panel.find({ key: 'picker' })).toBeDefined()
  await panel.unmount()

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await barColors(band)).toEqual(['#97cdff', '#5ab0ff', '#1d93ff'])
  await band.unmount()
})

const STATS_PANEL = { ...PANEL, props: { ...PANEL.props, args: 'stats' } } as const
const SCRIPTONITE = line({ app: 'Spotify.exe', artist: 'Скриптонит', title: 'Положение', isPlaying: true })
const SCRIPTONITE_PAUSED = line({ app: 'Spotify.exe', artist: 'Скриптонит', title: 'Положение', isPlaying: false })

test('listening adds up by track and artist, a pause adds nothing, and /player stats shows it', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  // A minute of Gym Class, half a minute of Положение, then a pause.
  await start(on, [COMMANDS, GYM_CLASS, 60_000, SCRIPTONITE, 30_000, SCRIPTONITE_PAUSED], clock)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()
  // Past the pause, before the stand-in helper ends at 150 s and starts over.
  await clock.advance(140_000)

  const text = (await $.command.run(run('stats'))).text ?? ''
  expect(text).toContain('Сегодня: 1 мин, треков: 2')
  expect(text).toContain('████████████ Lil Peep · 1 мин')
  expect(text).toContain('██████░░░░░░ Скриптонит · 30 с')
  expect(text).toContain('████████████ Lil Peep — Gym Class · 1 мин, раз: 1')
  expect(text).toContain('██████░░░░░░ Скриптонит — Положение · 30 с, раз: 1')

  const panel = await $.ui.mount({ ...STATS_PANEL, surface: 'desktop' })
  expect((await panel.find({ type: 'Text', text: /^За неделю/ }))?.text).toBe('За неделю: 1 мин, треков: 2')
  // The bars take the palette's color, Claude's middle shade.
  const colored = (await panel.findAll({ type: 'Text', text: /^█+$/ })).map(bar => bar.props.color).filter(Boolean)
  expect(colored).toEqual(['#d97757', '#d97757', '#d97757', '#d97757'])
  await panel.unmount()
})

test('stats an earlier session saved are shown, and the week leaves older days out', async ($, on) => {
  const clock = mock.clock(on, { now: 40 * 86_400_000 })
  const days = {
    [dayOf(40 * 86_400_000)]: { 'Lil Peep\nGym Class': { artist: 'Lil Peep', title: 'Gym Class', seconds: 3_700, plays: 2 } },
    [dayOf(20 * 86_400_000)]: { 'Old\nSong': { artist: 'Old', title: 'Song', seconds: 900, plays: 1 } },
  }
  await start(on, [COMMANDS], clock, { stats: { v: 1, days } })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()

  const text = (await $.command.run(run('stats'))).text ?? ''
  expect(text).toContain('Сегодня: 1 ч 1 мин, треков: 1')
  expect(text).toContain('Lil Peep — Gym Class · 1 ч 1 мин, раз: 2')
  expect(text).not.toContain('Old')
})

test('while another window counts, this one does not count the same music twice', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  await start(on, [COMMANDS, GYM_CLASS], clock, { statsOwner: { id: 'another window', at: 1_000_000 } })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()

  await clock.advance(60_000)
  expect((await $.command.run(run('stats'))).text).toContain('Пока пусто')

  // The other window went quiet: after its claim runs out, this one counts.
  await clock.advance(120_000)
  expect((await $.command.run(run('stats'))).text).toContain('Lil Peep — Gym Class · 1 мин')
})
