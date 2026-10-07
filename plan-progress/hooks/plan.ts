import type { Plan, PlanStep } from '../types'

export type StepInput = { title: string; estimateMin: number }

const MINUTE = 60_000

export function startPlan(title: string, steps: StepInput[], now: number): Plan {
  return {
    title,
    startedAt: now,
    current: 0,
    steps: steps.map((s, i) => ({ ...clean(s), ...(i === 0 ? { startedAt: now } : {}) })),
  }
}

/** Ends the running step and starts `index` (0-based); steps jumped over count as skipped. */
export function goTo(plan: Plan, index: number, now: number): Plan {
  const target = Math.max(0, Math.min(index, plan.steps.length))
  const steps = plan.steps.map((s, i): PlanStep => {
    if (i < target) {
      return s.endedAt !== undefined ? s : { ...s, startedAt: s.startedAt ?? now, endedAt: now }
    }
    if (i === target) {
      return { title: s.title, estimateMin: s.estimateMin, startedAt: s.startedAt !== undefined && s.endedAt === undefined ? s.startedAt : now }
    }
    return { title: s.title, estimateMin: s.estimateMin }
  })
  const isDone = target >= steps.length
  return { ...plan, steps, current: target, ...(isDone ? { finishedAt: now } : { finishedAt: undefined }) }
}

/** Replaces the steps from `from` (default: the running one) on, keeping what already ran. */
export function revise(plan: Plan, steps: StepInput[], from: number | undefined, now: number): Plan {
  const at = Math.max(0, Math.min(from ?? plan.current, plan.steps.length))
  const kept = plan.steps.slice(0, at)
  const fresh = steps.map((s, i): PlanStep => {
    const old = plan.steps[at + i]
    const isRunning = at + i === plan.current
    return { ...clean(s), ...(isRunning ? { startedAt: old?.startedAt ?? now } : {}) }
  })
  const merged = [...kept, ...fresh]
  const current = Math.min(plan.current, merged.length)
  return { ...plan, steps: merged, current, ...(current >= merged.length && merged.length > 0 ? { finishedAt: plan.finishedAt ?? now } : { finishedAt: undefined }) }
}

function clean(s: StepInput): PlanStep {
  return { title: String(s.title).trim() || 'Untitled step', estimateMin: Math.max(0, Number(s.estimateMin) || 0) }
}

export type Summary = {
  elapsedMs: number
  stepElapsedMs: number
  stepEstimateMs: number
  /** Estimated time still to go: the running step's unspent estimate plus every later step's. */
  remainingMs: number
  isOver: boolean
  isFinished: boolean
}

export function summarize(plan: Plan, now: number): Summary {
  const end = plan.finishedAt ?? now
  const running = plan.steps[plan.current]
  const isFinished = plan.finishedAt !== undefined || running === undefined
  const stepElapsedMs = !isFinished && running?.startedAt !== undefined ? now - running.startedAt : 0
  const stepEstimateMs = isFinished ? 0 : (running?.estimateMin ?? 0) * MINUTE
  const later = plan.steps.slice(plan.current + 1).reduce((sum, s) => sum + s.estimateMin * MINUTE, 0)
  return {
    elapsedMs: end - plan.startedAt,
    stepElapsedMs,
    stepEstimateMs,
    remainingMs: isFinished ? 0 : Math.max(0, stepEstimateMs - stepElapsedMs) + later,
    isOver: !isFinished && stepEstimateMs > 0 && stepElapsedMs > stepEstimateMs,
    isFinished,
  }
}

export function stepDurationMs(plan: Plan, i: number, now: number): number | undefined {
  const s = plan.steps[i]
  if (s?.startedAt === undefined) return undefined
  return (s.endedAt ?? now) - s.startedAt
}

export type Segment = { text: string; kind: 'done' | 'now' | 'left' | 'over' | 'todo' | 'gap' }

/**
 * The timeline as runs of cells, one block per step sized by its actual time (done),
 * its larger of elapsed and estimate (running) or its estimate (to do).
 */
export function timeline(plan: Plan, now: number, width: number): Segment[] {
  const n = plan.steps.length
  if (n === 0 || width < n) return []
  /** Separators only where every step still gets a cell of its own. */
  const hasGaps = width - (n - 1) >= n
  const room = hasGaps ? width - (n - 1) : width
  const weights = plan.steps.map((s, i) => {
    const est = s.estimateMin * MINUTE
    if (i < plan.current || plan.finishedAt !== undefined) return Math.max(stepDurationMs(plan, i, now) ?? 0, 1)
    if (i === plan.current) return Math.max(est, stepDurationMs(plan, i, now) ?? 0, 1)
    return Math.max(est, 1)
  })
  const cells = allocate(weights, room)
  const out: Segment[] = []
  plan.steps.forEach((s, i) => {
    if (i > 0 && hasGaps) out.push({ text: '│', kind: 'gap' })
    const w = cells[i] ?? 1
    if (i < plan.current || plan.finishedAt !== undefined) {
      out.push({ text: '━'.repeat(w), kind: 'done' })
    } else if (i === plan.current) {
      const spent = stepDurationMs(plan, i, now) ?? 0
      const est = s.estimateMin * MINUTE
      if (est > 0 && spent > est) {
        const ok = Math.max(1, Math.round((w * est) / spent))
        out.push({ text: '━'.repeat(Math.min(ok, w)), kind: 'now' })
        if (w - ok > 0) out.push({ text: '━'.repeat(w - ok), kind: 'over' })
      } else {
        const fill = est > 0 ? Math.min(w, Math.max(1, Math.round((w * spent) / est))) : w
        out.push({ text: '━'.repeat(fill), kind: 'now' })
        if (w - fill > 0) out.push({ text: '─'.repeat(w - fill), kind: 'left' })
      }
    } else {
      out.push({ text: '─'.repeat(w), kind: 'todo' })
    }
  })
  return out
}

/** Every weight gets at least one cell; the rest go by largest remainder. */
function allocate(weights: number[], room: number): number[] {
  const spare = room - weights.length
  const total = weights.reduce((a, b) => a + b, 0)
  const exact = weights.map(w => (spare * w) / total)
  const cells = exact.map(x => 1 + Math.floor(x))
  let left = room - cells.reduce((a, b) => a + b, 0)
  const order = exact.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0])
  for (const [, i] of order) {
    if (left <= 0) break
    cells[i] = (cells[i] ?? 0) + 1
    left -= 1
  }
  return cells
}

export function fmt(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h${String(m % 60).padStart(2, '0')}m`
}

export function clockTime(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** The plan as text: the tool's answer and the pane's fallback. */
export function describe(plan: Plan, now: number): string {
  const sum = summarize(plan, now)
  const head = sum.isFinished
    ? `Plan "${plan.title}" finished in ${fmt(sum.elapsedMs)}.`
    : `Plan "${plan.title}": step ${plan.current + 1}/${plan.steps.length}, ${fmt(sum.elapsedMs)} elapsed, ~${fmt(sum.remainingMs)} left.`
  const rows = plan.steps.map((s, i) => {
    const took = stepDurationMs(plan, i, now)
    const mark = i < plan.current || sum.isFinished ? 'done' : i === plan.current ? 'now ' : 'todo'
    return `  ${mark} ${i + 1}. ${s.title} — est ${s.estimateMin}m${took !== undefined ? `, ${fmt(took)}` : ''}`
  })
  return [head, ...rows].join('\n')
}
