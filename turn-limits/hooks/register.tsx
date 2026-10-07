import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Invocation } from '../types'
import { applyNotice, type Notice, parseLimit, parseNotification, reportText, statusText, summarize } from './tally'

const PANE = 'turn-limits'

const calls = atom({ plugin: 'turn-limits', key: 'calls' } as const, {})
const agents = atom({ plugin: 'turn-limits', key: 'agents' } as const, {})

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'turn-limits',
      description: 'Agent invocations that stopped at their turn limit, per agent type (args: reset)',
      argumentHint: '[reset]',
    })
    await $.tool.register({
      name: 'turn_limits',
      description:
        'Read-only: how many agent invocations of this session stopped at their turn limit, per agent type (hits/runs, %, the limits seen).',
      inputSchema: { type: 'object', properties: {} },
    })
    await refreshStatus($)

    return next(e)
  })

  on('tool.call', { tool: 'mcp__turn-limits__turn_limits' }, async $ => ({ result: reportText(summarize(await read($, calls))) }))

  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const id = e.tool_use_id
    const type = e.subagent_type?.trim() || 'general-purpose'
    await update($, calls, all => ({ ...all, [id]: { type } }))

    const ran = await next(e)
    if (ran.deny !== undefined) {
      await update($, calls, ({ [id]: _, ...rest }) => rest)
      return ran
    }
    const record = ran.result as { agentId?: unknown; agentType?: unknown } | undefined
    const agentId = typeof record?.agentId === 'string' ? record.agentId : undefined
    const limit = parseLimit(ran.text ?? '')
    await update($, calls, all => {
      const call = all[id] ?? { type }
      return { ...all, [id]: { ...call, ...(agentId ? { agentId } : {}), ...hit(call, limit) } }
    })
    await refreshStatus($)

    return ran
  })

  on('classic.SubagentStart', async ($, e, next) => {
    await update($, agents, all => ({ ...all, [e.agent_id]: e.agent_type }))
    return next(e)
  })

  on('session.append', async ($, e, next) => {
    const isUserRow = e.message.type === 'user' && e.message.role === 'user'
    if (isUserRow) {
      for (const block of e.message.content) {
        if (block.type !== 'text' || typeof block.text !== 'string') continue
        const notice = parseNotification(block.text)
        if (notice !== undefined) await recordNotice($, notice)
      }
    }
    return next(e)
  })

  on('command.run', { command: 'turn-limits' }, async ($, e) => {
    if (e.args.trim() === 'reset') {
      await update($, calls, () => ({}))
      await refreshStatus($)
      return { text: 'Turn-limit counters reset.' }
    }
    await $.ui.open({ id: PANE, title: 'Turn limits' })
    return { text: 'Turn-limits pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const sum = summarize(await read($, calls))
    if (sum.calls === 0) return <Text dimColor>No agent invocations in this session yet.</Text>

    const width = Math.max(...sum.rows.map(r => r.type.length), 10)
    return (
      <Box flexDirection="column">
        <Text bold color={sum.hits > 0 ? 'warning' : 'success'}>
          {sum.hits}/{sum.calls} invocations stopped at their turn limit ({sum.pct}%)
        </Text>
        <Text> </Text>
        <Text dimColor>
          {'type'.padEnd(width)}   hits/runs     %   limit
        </Text>
        {sum.rows.map(r => (
          <Text color={r.hits > 0 ? 'warning' : undefined} dimColor={r.hits === 0} wrap="truncate-end">
            {r.type.padEnd(width)}   {`${r.hits}/${r.calls}`.padStart(9)}  {`${r.pct}%`.padStart(4)}   {r.limits.join(', ') || '—'}
          </Text>
        ))}
      </Box>
    )
  })
}

function hit(call: Invocation, limit: number | undefined): Partial<Invocation> {
  return limit !== undefined && call.hitLimit === undefined ? { hitLimit: limit } : {}
}

async function recordNotice($: EngineInterface, notice: Notice) {
  const known = await read($, agents)
  await update($, calls, all => applyNotice(all, known, notice))
  await refreshStatus($)
}

async function refreshStatus($: EngineInterface) {
  $.ui.status(statusText(summarize(await read($, calls))))
}
