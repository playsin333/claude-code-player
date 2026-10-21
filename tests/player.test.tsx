import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { MockClock } from 'claude-code/testing'

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
  expect((await ui.find(EQUALIZER))?.text).toBe('▂▅▃')
  expect((await ui.find(EQUALIZER))?.props.mono).toBe(true)
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
  expect((await ui.find(EQUALIZER))?.text).toBe('▁▁▁')
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
  expect(answer.text).toContain('now-playing 1.3.0')
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
  expect((await ui.find(TIME))?.text).toBe('1:00 / 3:45')
  expect((await ui.find({ key: 'previous' }))?.props.label).toBe('⏮\uFE0E')
  expect((await ui.find({ key: 'toggle' }))?.props.label).toBe('⏸\uFE0E')
  expect((await ui.find({ key: 'next' }))?.props.label).toBe('⏭\uFE0E')

  // The time moves with the animation, every 300 ms.
  await clock.advance(5_100)
  expect((await ui.find(TIME))?.text).toBe('1:05 / 3:45')
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
  expect((await ui.find(TIME))?.text).toBe('1:00 / 3:45')
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
  expect(await ui.find(TIME)).toBeUndefined()
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
  expect((await ui.find(TIME))?.text).toBe('1:00 / 3:45')
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
