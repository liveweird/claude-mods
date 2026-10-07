import type { Invocation } from '../types'

const LIMIT = /stopped at its (\d+)-turn limit/

/** The turn limit a text says an agent stopped at, if it says so. */
export function parseLimit(text: string): number | undefined {
  const m = LIMIT.exec(text)
  return m?.[1] === undefined ? undefined : Number(m[1])
}

export type Notice = { toolUseId?: string; taskId?: string; limit: number }

/**
 * A task notification that reports a turn-limit stop. Only a row that IS a
 * notification counts: the text must open with the tag, so a tool result
 * quoting one (a grep over transcripts) never does.
 */
export function parseNotification(text: string): Notice | undefined {
  const body = text.trimStart()
  if (!body.startsWith('<task-notification>')) return undefined
  const limit = parseLimit(body)
  if (limit === undefined) return undefined
  const tag = (name: string) => new RegExp(`<${name}>([^<]+)</${name}>`).exec(body)?.[1]?.trim()
  return { toolUseId: tag('tool-use-id'), taskId: tag('task-id'), limit }
}

/** Marks the invocation a notice names, once; one never seen starts with SubagentStart's type, or unknown. */
export function applyNotice(
  calls: Record<string, Invocation>,
  agents: Record<string, string>,
  notice: Notice,
): Record<string, Invocation> {
  const byAgent = notice.taskId ? Object.entries(calls).find(([, c]) => c.agentId === notice.taskId)?.[0] : undefined
  const id = (notice.toolUseId && calls[notice.toolUseId] ? notice.toolUseId : byAgent) ?? notice.toolUseId ?? `task:${notice.taskId ?? '?'}`
  const call = calls[id] ?? {
    type: (notice.taskId && agents[notice.taskId]) || 'unknown',
    ...(notice.taskId ? { agentId: notice.taskId } : {}),
  }
  return call.hitLimit === undefined ? { ...calls, [id]: { ...call, hitLimit: notice.limit } } : { ...calls, [id]: call }
}

export type Row = { type: string; calls: number; hits: number; pct: number; limits: number[] }
export type Summary = { rows: Row[]; calls: number; hits: number; pct: number }

const pct = (hits: number, calls: number) => (calls === 0 ? 0 : Math.round((100 * hits) / calls))

/** Rows by hit percentage, then invocations, then name. */
export function summarize(calls: Record<string, Invocation>): Summary {
  const byType = new Map<string, Row>()
  for (const call of Object.values(calls)) {
    const row = byType.get(call.type) ?? { type: call.type, calls: 0, hits: 0, pct: 0, limits: [] }
    row.calls += 1
    if (call.hitLimit !== undefined) {
      row.hits += 1
      if (!row.limits.includes(call.hitLimit)) row.limits.push(call.hitLimit)
    }
    byType.set(call.type, row)
  }
  const rows = [...byType.values()]
    .map(r => ({ ...r, pct: pct(r.hits, r.calls), limits: [...r.limits].sort((a, b) => a - b) }))
    .sort((a, b) => b.pct - a.pct || b.calls - a.calls || a.type.localeCompare(b.type))
  const total = rows.reduce((t, r) => ({ calls: t.calls + r.calls, hits: t.hits + r.hits }), { calls: 0, hits: 0 })
  return { rows, ...total, pct: pct(total.hits, total.calls) }
}

/** The status-line entry; undefined until the first hit, so a clean session stays quiet. */
export function statusText(sum: Summary, maxLen = 80): string | undefined {
  if (sum.hits === 0) return undefined
  let text = `turn limits ${sum.hits}/${sum.calls} (${sum.pct}%)`
  const hit = [...sum.rows].filter(r => r.hits > 0).sort((a, b) => b.hits - a.hits || a.type.localeCompare(b.type))
  for (const [i, r] of hit.entries()) {
    const part = ` · ${r.type} ${r.hits}`
    const rest = hit.length - i - 1
    if ((text + part).length > maxLen - (rest > 0 ? 4 : 0)) return `${text} · …`
    text += part
  }
  return text
}

/** The summary as plain text: the read-only tool's answer. */
export function reportText(sum: Summary): string {
  if (sum.calls === 0) return 'No agent invocations in this session yet.'
  return [
    `${sum.hits}/${sum.calls} invocations stopped at their turn limit (${sum.pct}%).`,
    ...sum.rows.map(r => `  ${r.type}: ${r.hits}/${r.calls} (${r.pct}%)${r.limits.length ? `, limit ${r.limits.join(', ')}` : ''}`),
  ].join('\n')
}
