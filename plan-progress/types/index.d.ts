export type PlanStep = {
  title: string
  /** The estimate in minutes, as last given. */
  estimateMin: number
  startedAt?: number
  endedAt?: number
}

export type Plan = {
  title: string
  startedAt: number
  finishedAt?: number
  /** Index of the running step; equals steps.length once finished. */
  current: number
  steps: PlanStep[]
}

declare module 'claude-code' {
  interface PluginState {
    'plan-progress': { plan: Plan | null }
  }
}
