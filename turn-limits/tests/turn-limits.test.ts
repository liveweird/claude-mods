import { expect, test } from 'claude-code/testing'

import type { Invocation } from '../types'
import { applyNotice, parseLimit, parseNotification, reportText, statusText, summarize } from '../hooks/tally'

const notice = (toolUseId: string, taskId: string, limit: number, partial: boolean) =>
  [
    '<task-notification>',
    `<task-id>${taskId}</task-id>`,
    `<tool-use-id>${toolUseId}</tool-use-id>`,
    `<output-file>/tmp/tasks/${taskId}.output</output-file>`,
    '<status>completed</status>',
    `<summary>Agent "Survey things" stopped at its ${limit}-turn limit (partial result; SendMessage to task-id to continue)</summary>`,
    '<note>A task-notification fires each time this agent stops with no live background children of its own.</note>',
    partial
      ? `<result>NOTE: this agent stopped at its ${limit}-turn limit before finishing. The text below is PARTIAL output; treat it as incomplete.</result>`
      : `<result>NOTE: this agent stopped at its ${limit}-turn limit before finishing. It was still calling tools and had produced no report.</result>`,
    '</task-notification>',
  ].join('\n')

const PANE = {
  plugin: 'turn-limits',
  component: 'Pane',
  requestId: 'turn-limits',
  props: { title: 'Turn limits', isFocused: false, bodyColumns: 70, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

test('parsers read both notification bodies and ignore quotes', () => {
  expect(parseNotification(notice('toolu_A', 'a1', 30, true))).toEqual({ toolUseId: 'toolu_A', taskId: 'a1', limit: 30 })
  expect(parseNotification(notice('toolu_B', 'b2', 25, false))?.limit).toBe(25)
  expect(parseNotification(`grep output: ${notice('toolu_C', 'c3', 80, true)}`)).toBeUndefined()
  expect(parseNotification('<task-notification><status>completed</status></task-notification>')).toBeUndefined()
  expect(parseLimit('NOTE: this agent stopped at its 150-turn limit before finishing.')).toBe(150)
})

test('summary counts per type, sorts by rate and keeps the status line short', () => {
  const sum = summarize({
    a: { type: 'scout', hitLimit: 25 },
    b: { type: 'scout' },
    c: { type: 'scout' },
    d: { type: 'implementer', hitLimit: 150 },
    e: { type: 'reviewer' },
  })
  expect(sum.rows.map(r => [r.type, r.hits, r.calls, r.pct])).toEqual([
    ['implementer', 1, 1, 100],
    ['scout', 1, 3, 33],
    ['reviewer', 0, 1, 0],
  ])
  expect(statusText(sum)).toBe('turn limits 2/5 (40%) · implementer 1 · scout 1')
  expect(statusText(summarize({ x: { type: 'scout' } }))).toBeUndefined()
  expect(reportText(sum)).toContain('  scout: 1/3 (33%), limit 25')
  expect((statusText(sum, 30) ?? '').length).toBeLessThanOrEqual(30)
})

test('Agent calls and notifications fill the pane, one hit per invocation', async ($, on) => {
  const statuses: (string | undefined)[] = []
  on('ui.status', (_$, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('tool.call', { tool: 'Agent' }, (_$, e) =>
    e.prompt === 'foreground-limit'
      ? { result: { agentId: 'fg1' }, text: 'NOTE: this agent stopped at its 25-turn limit before finishing.' }
      : { result: { agentId: `bg-${e.description}` }, text: 'Async agent launched.' },
  )
  await $.tool.call({ tool: 'Agent', description: 'one', prompt: 'x', subagent_type: 'scout' })
  await $.tool.call({ tool: 'Agent', description: 'two', prompt: 'x', subagent_type: 'scout' })
  await $.tool.call({ tool: 'Agent', description: 'three', prompt: 'foreground-limit', subagent_type: 'gate-runner' })
  await $.tool.call({ tool: 'Agent', description: 'four', prompt: 'x' })

  expect(statuses.at(-1)).toBe('turn limits 1/4 (25%) · gate-runner 1')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /^1\/4 invocations stopped at their turn limit \(25%\)/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^gate-runner\s+1\/1\s+100%\s+25$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^scout\s+0\/2\s+0%\s+—$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^general-purpose\s+0\/1\s+0%\s+—$/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a notice marks its invocation once, joining by tool-use id, then agent id, then SubagentStart', () => {
  let calls: Record<string, Invocation> = { toolu_1: { type: 'scout', agentId: 'ag1' }, toolu_2: { type: 'implementer' } }
  const once = applyNotice(calls, {}, parseNotification(notice('toolu_1', 'ag1', 25, true))!)
  expect(once.toolu_1).toEqual({ type: 'scout', agentId: 'ag1', hitLimit: 25 })
  // Resumed and stopped again: still one hit, the first limit kept.
  expect(applyNotice(once, {}, { toolUseId: 'toolu_1', taskId: 'ag1', limit: 30 }).toolu_1?.hitLimit).toBe(25)
  // Unknown tool-use id, known agent id.
  calls = applyNotice(calls, {}, { toolUseId: 'toolu_x', taskId: 'ag1', limit: 25 })
  expect(Object.keys(calls)).toEqual(['toolu_1', 'toolu_2'])
  // Never seen at all: typed from SubagentStart.
  const fresh = applyNotice({}, { ag9: 'reviewer' }, { toolUseId: 'toolu_9', taskId: 'ag9', limit: 80 })
  expect(fresh).toEqual({ toolu_9: { type: 'reviewer', agentId: 'ag9', hitLimit: 80 } })
  expect(summarize(fresh).rows[0]).toMatchObject({ type: 'reviewer', hits: 1, calls: 1, limits: [80] })
})
