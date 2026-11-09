// Pure helpers: reading the cached server config and transcript lines, and describing what differs.
// Field names follow community reports (r/ClaudeCode, Nov 2026) and the notes in
// github.com/electricshadows44/am-i-nerfed (MIT): `clientDataCacheSlots[*].data.atis` /
// `.experimentKey`, and transcript rows `{"type":"atis-latch","atis":"..."}`.

export type Slot = { at: number; atis: string; key: string; data: Record<string, unknown> }

export type Status = {
  model: string
  slot: Slot | null
  /** Last `atis` written in this session's transcript; null when no such row was found. */
  latch: string | null
  /** The model whose prompt the engine rendered, when it is not `model`; null when they match or no prompt was seen. */
  promptModel: string | null
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** The newest cached slot for `model`, or null when the file has none (or is not JSON). */
export function newestSlot(configText: string, model: string): Slot | null {
  let cfg: unknown
  try {
    cfg = JSON.parse(configText)
  } catch {
    return null
  }
  const slots = isRecord(cfg) && isRecord(cfg.clientDataCacheSlots) ? Object.values(cfg.clientDataCacheSlots) : []
  let best: Record<string, unknown> | null = null
  for (const s of slots) {
    if (isRecord(s) && s.model === model && typeof s.at === 'number' && (!best || s.at > (best.at as number))) best = s
  }
  if (!best) return null
  const data = isRecord(best.data) ? best.data : {}
  return {
    at: best.at as number,
    atis: typeof data.atis === 'string' ? data.atis : '',
    key: typeof data.experimentKey === 'string' ? data.experimentKey : '',
    data,
  }
}

/** The value of the last `atis-latch` row in grep output, or null when there is none. */
export function lastLatch(grepOut: string): string | null {
  const all = [...grepOut.matchAll(/"atis":"([^"]*)"/g)]
  return all.length ? all[all.length - 1][1] : null
}

/** A short, non-secret label: the first 3 hex characters (how people name these IDs), else a hash of an opaque token. */
export function shortId(v: string): string {
  if (/^[0-9a-f]{3,}$/i.test(v)) return v.slice(0, 3).toLowerCase()
  let h = 0x811c9dc5
  for (let i = 0; i < v.length; i++) h = Math.imul(h ^ v.charCodeAt(i), 0x01000193) >>> 0
  return `${/^(v\d+)\./.exec(v)?.[1] ?? 'token'}:${h.toString(16).padStart(8, '0').slice(0, 6)}`
}

export const isExperiment = (s: Status): boolean => !!(s.slot?.atis || s.slot?.key || s.latch || s.promptModel)

/** Equal for the same assignment, '' when nothing marks one. */
export function signature(s: Status): string {
  if (!isExperiment(s)) return ''
  return [s.model, s.slot?.atis ? shortId(s.slot.atis) : '', s.slot?.key ?? '', s.latch ? shortId(s.latch) : '', s.promptModel ?? ''].join('|')
}

export function summary(s: Status): string {
  const parts: string[] = []
  const ids = [...new Set([s.slot?.atis, s.latch].filter((v): v is string => !!v).map(shortId))]
  if (ids.length) parts.push(`ID ${ids.join(', ')}`)
  if (s.slot?.key) parts.push(s.slot.key)
  if (s.promptModel) parts.push(`prompt built for ${s.promptModel}`)
  return `${s.model} is in an experiment: ${parts.join('; ')}.`
}

const brief = (v: unknown): string => {
  const t = JSON.stringify(v) ?? String(v)
  return t.length > 120 ? `${t.slice(0, 117)}...` : t
}

/** What the slot's payload adds, drops or changes against a clean one; the assignment fields themselves are left out. */
export function diffData(base: Record<string, unknown>, cur: Record<string, unknown>): string[] {
  const skip = (k: string) => k === 'atis' || k === 'experimentKey'
  const out: string[] = []
  for (const k of Object.keys(cur)) {
    if (skip(k)) continue
    if (!(k in base)) out.push(`${k} added: ${brief(cur[k])}`)
    else if (JSON.stringify(base[k]) !== JSON.stringify(cur[k])) out.push(`${k} changed: ${brief(base[k])} -> ${brief(cur[k])}`)
  }
  for (const k of Object.keys(base)) if (!skip(k) && !(k in cur)) out.push(`${k} removed (was ${brief(base[k])})`)
  return out
}

export function diffIds(base: readonly string[], cur: readonly string[]): string[] {
  return [
    ...cur.filter(id => !base.includes(id)).map(id => `section ${id} added`),
    ...base.filter(id => !cur.includes(id)).map(id => `section ${id} removed`),
  ]
}
