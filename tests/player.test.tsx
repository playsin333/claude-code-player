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

const line = (track: object | null): string => `${JSON.stringify({ track })}\r\n`

const GYM_CLASS = line({ app: 'Spotify.exe', artist: 'Lil Peep', title: 'Gym Class', isPlaying: true })

// Stands for the engine beneath the plugin: a helper that prints `lines`,
// then stays alive until the clock passes a minute.
const start = async (
  on: On,
  lines: string[],
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
    for (const text of lines) yield { stream: 'stdout' as const, text }
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
  expect(text?.text).toBe('▂▅▃  Lil Peep — Gym Class')
  expect(text?.props.size).toBe('caption')
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
  expect((await ui.find({ type: 'Text', text: /Gym Class/ }))?.text).toBe('▂▅▃  Lil Peep — Gym Class')
  await ui.unmount()
})

test('a JSON line split across pieces is still read', async ($, on) => {
  const clock = mock.clock(on)
  const whole = line({ app: 'Spotify.exe', artist: 'Скриптонит', title: 'Положение', isPlaying: false })
  await start(on, [whole.slice(0, 20), whole.slice(20)], clock)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Положение/ }))?.text).toBe('▁▁▁  Скриптонит — Положение')
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
  expect(answer.text).toContain('now-playing 1.1.3')
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

test('/player test hint draws the track in the hint line until turned off', async ($, on) => {
  const clock = mock.clock(on)
  await start(on, [GYM_CLASS], clock)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()
  const HINT = {
    plugin: 'now-playing',
    component: 'PromptHint',
    props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
  } as const

  const before = await $.ui.mount({ ...HINT, surface: 'desktop' })
  expect(await before.find({ type: 'Text', text: /Gym Class/ })).toBeUndefined()
  await before.unmount()

  expect((await $.command.run(run('test hint'))).text).toContain('Опыт включён')
  const during = await $.ui.mount({ ...HINT, surface: 'desktop' })
  expect((await during.find({ type: 'Text', text: /Gym Class/ }))?.text).toBe('▂▅▃  Lil Peep — Gym Class')
  expect((await during.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await during.unmount()

  expect((await $.command.run(run('debug'))).text).toContain('что там пишет приложение: ? for shortcuts')
  expect((await $.command.run(run('test hint'))).text).toBe('Опыт выключен.')
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
})
