export type Invocation = {
  /** The agent type, from the Agent call's subagent_type (or SubagentStart). */
  type: string
  agentId?: string
  /** The turn limit it stopped at; set once, on the first notice. */
  hitLimit?: number
}

declare module 'claude-code' {
  interface PluginState {
    'turn-limits': {
      /** Keyed by the Agent call's tool_use_id. */
      calls: Record<string, Invocation>
      /** agent_id -> agent_type, from classic.SubagentStart: the fallback join. */
      agents: Record<string, string>
    }
  }
}
