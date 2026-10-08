export type Status = 'next' | 'todo' | 'new' | 'parked' | 'blocked'

export type Item = {
  status: Status
  /** The item's first bold run, else its first sentence, clipped. */
  title: string
  /** The `##` section it sits under. */
  section: string
}

export type Backlog = {
  /** Whether BACKLOG.md was read at all. */
  found: boolean
  items: Item[]
  /** Top-level bullets under a section that carry no tag. */
  untagged: number
}

declare module 'claude-code' {
  interface PluginState {
    backlog: {
      /** BACKLOG.md as last read from the working directory. */
      backlog: Backlog
    }
  }
}
