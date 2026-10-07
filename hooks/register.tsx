import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Plan } from '../types'
import {
  clockTime,
  describe,
  fmt,
  goTo,
  revise,
  type Segment,
  startPlan,
  stepDurationMs,
  type StepInput,
  summarize,
  timeline,
} from './plan'

const PANE = 'plan-progress'
const TOOL = 'mcp__plan-progress__plan_progress'
const TICK_MS = 10_000
/** A finished plan stays on the band this long, then leaves it. */
const LINGER_MS = 10 * 60_000

const plan = atom({ plugin: 'plan-progress', key: 'plan' } as const, null)

const COLOR: Record<Segment['kind'], string> = {
  done: 'success',
  now: 'suggestion',
  over: 'warning',
  left: 'suggestion',
  todo: 'inactive',
  gap: 'subtle',
}

/** Done is green, the running step blue (solid for time spent, thin for its rest), later steps grey. */
const DIM: ReadonlySet<Segment['kind']> = new Set(['todo', 'gap'])

const STEPS_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Short step name (a few words).' },
      estimateMin: { type: 'number', description: 'Estimated duration in minutes.' },
    },
    required: ['title', 'estimateMin'],
  },
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'plan_progress',
      description: [
        'Reports progress through the plan being executed, shown to the user as a timeline above the prompt.',
        'Call action "start" when you begin executing a multi-step plan (title + steps, each with an estimate in minutes).',
        'Call action "step" with the 1-based step number each time you move on to a step.',
        'Call action "revise" when steps or estimates change (steps replace the list from step `from`, default the running one).',
        'Call action "finish" when the plan is done, "clear" to drop it, "show" to read it back.',
      ].join(' '),
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['start', 'step', 'revise', 'finish', 'clear', 'show'] },
          title: { type: 'string', description: 'start: the plan name.' },
          steps: { ...STEPS_SCHEMA, description: 'start/revise: the steps in order.' },
          step: { type: 'number', description: 'step: the 1-based step now starting.' },
          from: { type: 'number', description: 'revise: the 1-based step the new list starts at.' },
        },
        required: ['action'],
      },
    })
    await $.command.register({
      name: 'plan-progress',
      description: 'Show the running plan as a timeline (args: clear)',
      argumentHint: '[clear]',
    })
    $.clock.every(TICK_MS, async () => {
      const p = await read($, plan)
      if (p !== null && p.finishedAt === undefined) $.ui.invalidate('ui.render')
    })

    return next(e)
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const now = await $.clock.now()
    const current = await read($, plan)
    const steps = Array.isArray(e.steps) ? (e.steps as StepInput[]) : undefined
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : undefined)
    let nextPlan: Plan | null = current

    switch (e.action) {
      case 'start':
        if (!steps?.length) return { result: 'start needs a non-empty steps list.', isError: true }
        nextPlan = startPlan(typeof e.title === 'string' && e.title.trim() ? e.title.trim() : 'Plan', steps, now)
        break
      case 'step': {
        const n = num(e.step)
        if (current === null) return { result: 'No plan is running; call start first.', isError: true }
        if (n === undefined || n < 1 || n > current.steps.length) {
          return { result: `step must be 1..${current.steps.length}.`, isError: true }
        }
        nextPlan = goTo(current, n - 1, now)
        break
      }
      case 'revise': {
        if (current === null) return { result: 'No plan is running; call start first.', isError: true }
        if (!steps) return { result: 'revise needs steps.', isError: true }
        const from = num(e.from)
        nextPlan = revise(current, steps, from === undefined ? undefined : from - 1, now)
        if (typeof e.title === 'string' && e.title.trim()) nextPlan = { ...nextPlan, title: e.title.trim() }
        break
      }
      case 'finish':
        if (current === null) return { result: 'No plan is running.', isError: true }
        nextPlan = goTo(current, current.steps.length, now)
        break
      case 'clear':
        nextPlan = null
        break
      case 'show':
        break
      default:
        return { result: 'action must be one of start, step, revise, finish, clear, show.', isError: true }
    }

    if (nextPlan !== current) await update($, plan, () => nextPlan)
    return { result: nextPlan === null ? 'No plan.' : describe(nextPlan, now) }
  })

  on('command.run', { command: 'plan-progress' }, async ($, e) => {
    if (e.args.trim() === 'clear') {
      await update($, plan, () => null)
      return { text: 'Plan progress cleared.' }
    }
    await $.ui.open({ id: PANE, title: 'Plan progress' })
    return { text: 'Plan progress pane opened.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const p = await read($, plan)
    if (e.props.hasSurvey || p === null) return next(e)
    const now = await $.clock.now()
    if (p.finishedAt !== undefined && now - p.finishedAt > LINGER_MS) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const width = Math.max(10, e.props.bodyColumns)
    const sum = summarize(p, now)
    const step = p.steps[p.current]

    return (
      <Box flexDirection="column">
        <Text wrap="truncate-end">
          <Text dimColor>Plan · {p.title} · </Text>
          {sum.isFinished ? (
            <Text color="success" bold>
              ✓ done, {p.steps.length} steps
            </Text>
          ) : (
            <Text bold color={sum.isOver ? 'warning' : 'suggestion'}>
              step {p.current + 1}/{p.steps.length}: {step?.title}
            </Text>
          )}
        </Text>
        {bar($, e, p, now, width)}
        <Text wrap="truncate-end" dimColor>
          {statusLine(p, now)}
        </Text>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const p = await read($, plan)
    if (p === null) {
      return (
        <Text dimColor>
          No plan is running. Claude reports one with its plan_progress tool when it starts executing a plan.
        </Text>
      )
    }
    const now = await $.clock.now()
    const width = Math.max(10, e.props.bodyColumns)
    const sum = summarize(p, now)
    let cursor = now + Math.max(0, sum.stepEstimateMs - sum.stepElapsedMs)

    return (
      <Box flexDirection="column">
        <Text bold wrap="truncate-end">
          {p.title}
        </Text>
        <Text dimColor wrap="truncate-end">
          {statusLine(p, now)}
        </Text>
        {bar($, e, p, now, width)}
        <Text> </Text>
        {p.steps.map((s, i) => {
          const isDone = sum.isFinished || i < p.current
          const isNow = !sum.isFinished && i === p.current
          const took = stepDurationMs(p, i, now)
          let right: string
          let color: string | undefined
          if (isDone) {
            right = `${fmt(took ?? 0)} / est ${s.estimateMin}m`
            color = 'success'
          } else if (isNow) {
            right = `${fmt(took ?? 0)} / est ${s.estimateMin}m`
            color = sum.isOver ? 'warning' : 'suggestion'
          } else {
            right = `est ${s.estimateMin}m · ≈${clockTime(cursor)}`
            cursor += s.estimateMin * 60_000
          }
          return (
            <Box flexDirection="row" key={`step-${i}`}>
              <Box flexGrow={1} flexShrink={1}>
                <Text wrap="truncate-end" color={color} bold={isNow} dimColor={!isDone && !isNow}>
                  {isDone ? '✓' : isNow ? '▶' : '·'} {i + 1}. {s.title}
                </Text>
              </Box>
              <Text color={isNow ? color : undefined} dimColor={!isNow}> {right}</Text>
            </Box>
          )
        })}
      </Box>
    )
  })
}

function statusLine(p: Plan, now: number): string {
  const sum = summarize(p, now)
  if (sum.isFinished) {
    const est = p.steps.reduce((t, s) => t + s.estimateMin, 0)
    return `took ${fmt(sum.elapsedMs)} (estimated ${fmt(est * 60_000)}) · finished ${clockTime(p.finishedAt ?? now)}`
  }
  const stepPart = sum.isOver
    ? `step ${fmt(sum.stepElapsedMs)}, ${fmt(sum.stepElapsedMs - sum.stepEstimateMs)} over its ${fmt(sum.stepEstimateMs)}`
    : `step ${fmt(sum.stepElapsedMs)} of ~${fmt(sum.stepEstimateMs)}`
  return `elapsed ${fmt(sum.elapsedMs)} · ${stepPart} · ~${fmt(sum.remainingMs)} left · ETA ${clockTime(now + sum.remainingMs)}`
}

function bar($: EngineInterface, e: Parameters<EngineInterface['ui']['resolve']>[0], p: Plan, now: number, width: number) {
  const { Box, Text } = $.ui.resolve(e)
  const segments = timeline(p, now, width)
  return (
    <Box flexDirection="row">
      {segments.map(s => (
        <Text color={COLOR[s.kind]} bold={s.kind === 'now'} dimColor={DIM.has(s.kind)}>
          {s.text}
        </Text>
      ))}
    </Box>
  )
}
