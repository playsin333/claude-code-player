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

const run = (args: string) => ({
  command: 'player',
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: false, columns: 80 },
})

const line = (track: object | null): string => `${JSON.stringify({ track })}\r\n`

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
  on('ui.status', (_, e) => {
    statuses.push(e.text ?? '')
    return { value: undefined }
  })
  on('process.spawn', async function* () {
    for (const text of lines) yield { stream: 'stdout' as const, text }
    await clock.sleep(60_000)
    return { value: { code: 0, signal: null } }
  })
  // The engine's own band, drawn when the plugin has nothing to show.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  return statuses
}

test('the band shows the cleaned track', async ($, on) => {
  const clock = mock.clock(on)
  await start(
    on,
    [
      line({ app: 'chrome.exe', artist: '', title: 'Lil Peep - Gym Class (Official Video)', isPlaying: true }),
    ],
    clock,
  )
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const row = await ui.find({ type: 'Text', text: /Gym Class/ })
  expect(row?.text).toBe('▂▅▃  Lil Peep — Gym Class')
  await ui.unmount()
})

test('a JSON line split across pieces is still read', async ($, on) => {
  const clock = mock.clock(on)
  const whole = line({ app: 'Spotify.exe', artist: 'Скриптонит', title: 'Положение', isPlaying: false })
  await start(on, [whole.slice(0, 20), whole.slice(20)], clock)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const row = await ui.find({ type: 'Text', text: /Положение/ })
  expect(row?.text).toBe('▁▁▁  Скриптонит — Положение')
  await ui.unmount()
})

test('/player line moves the player to the status line', async ($, on) => {
  const clock = mock.clock(on)
  const statuses = await start(
    on,
    [line({ app: 'Spotify.exe', artist: 'Lil Peep', title: 'Gym Class', isPlaying: true })],
    clock,
  )
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()

  const answer = await $.command.run(run('line'))
  expect(answer.text).toContain('строчкой')
  expect(statuses.at(-1)).toContain('Lil Peep — Gym Class')

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Gym Class/ })).toBeUndefined()
  await ui.unmount()
})

test('a mode saved earlier is used from the start', async ($, on) => {
  const clock = mock.clock(on)
  await start(
    on,
    [line({ app: 'Spotify.exe', artist: 'Lil Peep', title: 'Gym Class', isPlaying: true })],
    clock,
    { mode: 'off' },
  )
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Gym Class/ })).toBeUndefined()
  await ui.unmount()
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
