import type { EngineInterface, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { diffData, newestSlot, shortId } from '../hooks/detect'

const HOME = '/home/u'
const SID = 'sid-1'
const TRANSCRIPT = `${HOME}/.claude/projects/-w-proj/${SID}.jsonl`
const MODEL = 'claude-opus-5-5'
const V1 = `v1.${'Ab-_'.repeat(43)}`
const CLEAN = { cedar_basin: 'x', original_games_guidance: false }

type World = { config: string; latch: string; promptModel: string; ids: string[]; toasts: string[]; notes: string[] }

const cfg = (data: Record<string, unknown>, at = 2000) =>
  JSON.stringify({
    clientDataCacheSlots: {
      old: { model: MODEL, entrypoint: 'claude-desktop', at: 1, data: { stale: true } },
      cur: { model: MODEL, entrypoint: 'claude-desktop', at, data },
      other: { model: 'claude-fable-5-1', entrypoint: 'claude-desktop', at: 9000, data: { atis: 'fff0000000000000' } },
    },
  })

function world(on: On, w: World) {
  mock.store(on)
  mock.env(on, { HOME })
  const clock = mock.clock(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: SID }))
  on('session.cwd', () => ({ value: '/w/proj' }))
  on('session.model', () => ({ value: `${MODEL}[1m]` }))
  on('session.version', () => ({ value: { version: '2.1.317' } }))
  on('command.register', () => ({ value: { command: 'experiment-check' } }))
  on('fs.exists', (_, e) => ({ value: e.path === TRANSCRIPT }))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', (_, e) => ({ value: e.path === `${HOME}/.claude.json` ? w.config : '' }))
  on('process.run', () => ({
    value: { exitCode: 0, stdout: `"type":"atis-latch","atis":""\n"type":"atis-latch","atis":"${w.latch}"\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('ui.toast', (_, e) => (w.toasts.push(e.text), { value: undefined }))
  on('ui.notify', (_, e) => (w.notes.push(e.text), { value: { isSent: false, reason: 'no-surface' } }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, null, '')
  })
  on('prompt.compose', () => ({ sections: w.ids.map(id => ({ id, text: id, scope: 'shared' as const })) }))
  return clock
}

const start = ($: EngineInterface) => $.session.start({ cwd: '/w/proj', surface: 'desktop', isInteractive: true })
const compose = ($: EngineInterface, w: World) =>
  $.prompt.compose({ model: MODEL, promptModel: w.promptModel, surfaces: ['desktop'], tools: [], outputStyle: null, traits: [] })
const report = async ($: EngineInterface) =>
  (await $.command.run({ command: 'experiment-check', args: '', origin: { kind: 'sdk' }, presentation: { isFullscreen: false, columns: 80 } })).text ?? ''
/** The band's text on the desktop surface, '' when the mod leaves the band to the engine. */
async function band($: EngineInterface & { ui: { mount: Function } }): Promise<string> {
  const ui = await $.ui.mount({ plugin: 'experiment-watch', surface: 'desktop', component: 'AbovePrompt', requestId: 'band', props: { hasSurvey: false, bodyColumns: 80 } })
  const t = await ui.find({ type: 'Text', text: /experiment/ })
  await ui.unmount()
  return t?.text ?? ''
}
const fresh = (): World => ({ config: cfg(CLEAN), latch: '', promptModel: MODEL, ids: ['intro', 'tools'], toasts: [], notes: [] })

test('dw1: a clean setup raises nothing and the report says so', async ($, on) => {
  const w = fresh()
  const clock = world(on, w)
  await start($)
  await compose($, w)
  await clock.advance(61_000)
  expect(w.toasts).toEqual([])
  const text = await report($)
  expect(text).toContain('No experiment marker found.')
  expect(text).toContain(`Prompt: built for ${MODEL} (matches)`)
  expect(w.toasts).toEqual([])
})

test('dw2: an ID and key in the cached config raise one alert and list the payload change', async ($, on) => {
  const w = fresh()
  const clock = world(on, w)
  await start($)
  await compose($, w)
  w.config = cfg({ ...CLEAN, atis: 'c0e57166b42fa4af', experimentKey: 'claude_code_x_experiment', breezy_horizon: { [MODEL]: 'claude-opus-4-8' } }, 3000)
  await clock.advance(61_000)
  expect(w.toasts.length).toBe(1)
  expect(w.toasts[0]).toContain('ID c0e')
  expect(w.toasts[0]).toContain('claude_code_x_experiment')
  expect(w.notes.length).toBe(1)
  await clock.advance(600_000)
  expect(w.toasts.length).toBe(1)
  const text = await report($)
  expect(text).toContain('breezy_horizon added: {"claude-opus-5-5":"claude-opus-4-8"}')
  expect(text).not.toContain('c0e57166b42fa4af')
  expect(await band($)).toContain('ID c0e')
})

test('dw3: a prompt built for another model is an experiment, with the swap named', async ($, on) => {
  const w = fresh()
  world(on, w)
  await start($)
  await compose($, w)
  w.promptModel = 'claude-opus-4-8'
  w.ids = ['intro', 'tools', 'corrections']
  await compose($, w)
  const text = await report($)
  expect(w.toasts[0]).toContain('prompt built for claude-opus-4-8')
  expect(text).toContain("the system prompt is claude-opus-4-8's, not claude-opus-5-5's")
  expect(text).toContain('section corrections added')
})

test('dw4: an opaque token in the transcript is shown only as a short hash', async ($, on) => {
  const w = fresh()
  w.latch = V1
  world(on, w)
  await start($)
  const text = await report($)
  expect(w.toasts[0]).toContain(`ID ${shortId(V1)}`)
  expect(text).toContain(`latest ID row: ${shortId(V1)}`)
  expect(text).toContain('nothing to compare with')
  expect(`${text}${w.toasts.join('')}`).not.toContain(V1.slice(3, 20))
})

test('dw5: leaving the experiment is announced and clears the band', async ($, on) => {
  const w = fresh()
  w.latch = 'e6d0000000000000'
  const clock = world(on, w)
  await start($)
  await clock.advance(1)
  w.latch = ''
  await clock.advance(61_000)
  expect(w.toasts.at(-1)).toContain('no longer in an experiment (was: claude-opus-5-5 is in an experiment: ID e6d.)')
  expect(await band($)).toBe('')
})

test('helpers: newest slot per model, hex IDs to 3 characters, payload diff', () => {
  expect(newestSlot(cfg(CLEAN), MODEL)?.data).toEqual(CLEAN)
  expect(newestSlot('not json', MODEL)).toBe(null)
  expect(shortId('C0E57166B42FA4AF')).toBe('c0e')
  expect(shortId(V1)).toMatch(/^v1:[0-9a-f]{6}$/)
  expect(diffData({ a: 1, b: 2, atis: 'x' }, { a: 1, b: 3, c: true, atis: 'y' })).toEqual(['b changed: 2 -> 3', 'c added: true'])
  expect(diffData({ a: 1 }, {})).toEqual(['a removed (was 1)'])
})
