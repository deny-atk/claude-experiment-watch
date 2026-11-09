import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Alert } from '../types'
import { diffData, diffIds, isExperiment, lastLatch, newestSlot, shortId, signature, summary } from './detect'
import type { Status } from './detect'

const alert = atom({ plugin: 'experiment-watch', key: 'alert' } as const, null as Alert | null)
const dismissed = atom({ plugin: 'experiment-watch', key: 'dismissed' } as const, null as string | null)

type Last = { sig: string; text: string }
type Composed = { promptModel: string; ids: string[] }

// Per model: the prompt the engine last composed. Lost on reload; the next compose fills it again.
const composed = new Map<string, Composed>()
let transcript: string | null | undefined

async function locate($: EngineInterface) {
  const home = await $.env.get('HOME')
  const dir = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${home}/.claude`
  const config = (await $.env.get('CLAUDE_CONFIG_DIR')) ? `${dir}/.claude.json` : `${home}/.claude.json`
  if (transcript === undefined) {
    const id = await $.session.id()
    const projects = `${dir}/projects`
    const guess = `${projects}/${(await $.session.cwd()).replace(/[^a-zA-Z0-9]/g, '-')}/${id}.jsonl`
    transcript = (await $.fs.exists(guess)) ? guess : null
    if (!transcript) {
      for (const entry of await $.fs.list(projects).catch(() => [])) {
        const p = `${projects}/${entry.name}/${id}.jsonl`
        if (entry.kind === 'dir' && (await $.fs.exists(p))) {
          transcript = p
          break
        }
      }
    }
  }
  return { config, transcript }
}

async function check($: EngineInterface): Promise<{ s: Status; changes: string[] | null }> {
  const model = (await $.session.model()).replace(/\[.*\]$/, '')
  const where = await locate($)
  const slot = newestSlot(await $.fs.read(where.config).catch(() => ''), model)
  let latch: string | null = null
  if (where.transcript) {
    const ran = await $.process
      .run(['grep', '-o', '"type":"atis-latch","atis":"[^"]*"', where.transcript])
      .catch(() => null)
    latch = ran ? lastLatch(ran.stdout) : null
  }
  const seen = composed.get(model)
  const s: Status = {
    model,
    slot,
    latch: latch || null,
    promptModel: seen && seen.promptModel !== model ? seen.promptModel : null,
  }

  let changes: string[] | null = null
  if (!isExperiment(s)) {
    // Clean: remember what this model's config and prompt look like, to compare against later.
    if (slot) await $.store.set(`slot:${model}`, slot.data)
    if (seen) await $.store.set(`sections:${model}`, seen.ids)
  } else {
    const baseSlot = (await $.store.get(`slot:${model}`)) as Record<string, unknown> | undefined
    const baseIds = (await $.store.get(`sections:${model}`)) as string[] | undefined
    if (baseSlot || baseIds) {
      changes = [
        ...(baseSlot && slot ? diffData(baseSlot, slot.data) : []),
        ...(baseIds && seen ? diffIds(baseIds, seen.ids) : []),
      ]
    }
  }

  const sig = signature(s)
  const last = ((await $.store.get(`last:${model}`)) as Last | undefined) ?? { sig: '', text: '' }
  if (sig !== last.sig) {
    const text = sig ? `${summary(s)} Run /experiment-check for details.` : `${model} is no longer in an experiment (was: ${last.text})`
    await $.store.set(`last:${model}`, { sig, text: sig ? summary(s) : '' })
    $.ui.toast(text, { timeoutMs: 15000 })
    void $.ui.notify(text, { title: 'Claude Code experiment' }).catch(() => undefined)
  }
  await update($, alert, () => (sig ? { sig, text: summary(s) } : null))
  return { s, changes }
}

async function report($: EngineInterface): Promise<string> {
  const { s, changes } = await check($)
  const { version } = await $.session.version()
  const lines = [`Model: ${s.model} (Claude Code ${version})`, isExperiment(s) ? summary(s) : 'No experiment marker found.', '']
  lines.push(
    s.slot
      ? `Cached server config, fetched ${new Date(s.slot.at).toISOString()}: ID ${s.slot.atis ? shortId(s.slot.atis) : 'none'}${s.slot.key ? `, key ${s.slot.key}` : ''}`
      : 'Cached server config: no entry for this model.',
    transcript
      ? `This session's transcript, latest ID row: ${s.latch ? shortId(s.latch) : 'blank'}`
      : "This session's transcript: not found.",
    composed.has(s.model)
      ? `Prompt: built for ${s.promptModel ?? `${s.model} (matches)`}`
      : 'Prompt: not seen. Either none was built yet, or a managed plugin passes the prompt on before mods see it, so a prompt built for another model goes unnoticed here.',
  )
  if (isExperiment(s)) {
    lines.push('', 'What differs from the last clean state seen for this model:')
    if (changes === null) lines.push('- nothing to compare with: no clean state was recorded before this experiment.')
    else if (!changes.length && !s.promptModel) lines.push('- nothing visible on this machine.')
    else lines.push(...(s.promptModel ? [`- the system prompt is ${s.promptModel}'s, not ${s.model}'s`] : []), ...changes.map(c => `- ${c}`))
  }
  lines.push(
    '',
    'Limits: this reads local files and the prompt this app builds. Changes made on Anthropic\'s servers are not visible here, and "none" means no marker, not that nothing is being tested.',
  )
  return lines.join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'experiment-check',
      description: 'Show whether this session is in a Claude Code experiment and what changed',
    })
    await check($).catch(() => undefined)
    // The app may fetch its server config after start, and again later.
    $.clock.after(60_000, () => void check($).catch(() => undefined))
    $.clock.every(600_000, () => void check($).catch(() => undefined))
    return started
  })

  on('command.run', { command: 'experiment-check' }, async $ => ({ text: await report($) }))

  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    const now: Composed = { promptModel: e.promptModel, ids: result.sections.map(x => x.id) }
    const before = composed.get(e.model)
    composed.set(e.model, now)
    if (!before || before.promptModel !== now.promptModel || before.ids.join() !== now.ids.join()) {
      await check($).catch(() => undefined)
    }
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const a = await read($, alert)
    if (!a || e.props.hasSurvey || a.sig === (await read($, dismissed))) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box>
        <Text color="yellow">⚗ {a.text} /experiment-check for details </Text>
        <Button key="dismiss" label="Dismiss" onPress={() => update($, dismissed, () => a.sig)} />
      </Box>
    )
  })
}
