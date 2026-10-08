import type { Backlog, Item, Status } from '../types'

export const STATUSES: readonly Status[] = ['next', 'todo', 'new', 'parked', 'blocked']

export const EMPTY: Backlog = { found: false, items: [], untagged: 0 }

const BULLET = /^[-*+]\s+(.*)$/
const TAG = /^\[(next|todo|new|parked|blocked)\]\s*(.*)$/i
const SECTION = /^##\s+(.*?)\s*#*\s*$/
const FENCE = /^\s*(```|~~~)/
const BOLD = /\*\*(.+?)\*\*/
const TITLE_MAX = 60

/**
 * The tagged items of a backlog file. An item is a top-level bullet under a `##` section, tagged at its start
 * (`- [todo] **Title.** …`); nested bullets belong to their parent, the preamble before the first `##` and fenced
 * code are not items, and an untagged top-level bullet is only counted.
 */
export function parseBacklog(md: string): Backlog {
  const items: Item[] = []
  let untagged = 0
  let section: string | undefined
  let fenced = false
  for (const line of md.split(/\r?\n/)) {
    if (FENCE.test(line)) fenced = !fenced
    if (fenced) continue
    const heading = SECTION.exec(line)
    if (heading) {
      section = heading[1]
      continue
    }
    if (section === undefined) continue
    const bullet = BULLET.exec(line)
    if (!bullet) continue
    const tag = TAG.exec(bullet[1] ?? '')
    if (!tag) {
      untagged += 1
      continue
    }
    items.push({ status: (tag[1] ?? '').toLowerCase() as Status, title: titleOf(tag[2] ?? ''), section })
  }
  return { found: true, items, untagged }
}

/** The first bold run, else the text up to its first sentence end, at most TITLE_MAX characters. */
export function titleOf(text: string): string {
  const bold = BOLD.exec(text)?.[1]
  const raw = (bold ?? text.split(/(?<=[.:;])\s/)[0] ?? text).trim().replace(/[.:;,]+$/, '')
  return raw.length > TITLE_MAX ? `${raw.slice(0, TITLE_MAX - 1)}…` : raw
}

export type Summary = {
  found: boolean
  next: Item[]
  byStatus: Record<Status, Item[]>
  untagged: number
  tagged: number
}

export function summarize(backlog: Backlog): Summary {
  const byStatus = Object.fromEntries(STATUSES.map(s => [s, backlog.items.filter(i => i.status === s)])) as Record<Status, Item[]>
  return { found: backlog.found, next: byStatus.next, byStatus, untagged: backlog.untagged, tagged: backlog.items.length }
}

/** The non-zero counts, parked and blocked together: `9 to-do · 2 new · 3 parked/blocked`. */
function counts(sum: Summary): string[] {
  const held = sum.byStatus.parked.length + sum.byStatus.blocked.length
  return [
    sum.byStatus.todo.length ? `${sum.byStatus.todo.length} to-do` : '',
    sum.byStatus.new.length ? `${sum.byStatus.new.length} new` : '',
    held ? `${held} parked/blocked` : '',
  ].filter(Boolean)
}

const MIN_TITLE = 12

/** The status-line entry; undefined without a tagged backlog, so other repos stay quiet. */
export function statusText(sum: Summary, maxLen = 80): string | undefined {
  if (!sum.found || sum.tagged === 0) return undefined
  const tail = counts(sum).map(c => ` · ${c}`).join('')
  const first = sum.next[0]
  if (first === undefined) return `backlog${tail}`.slice(0, maxLen)
  const more = sum.next.length > 1 ? ` +${sum.next.length - 1}` : ''
  const room = maxLen - `backlog · next: ${more}${tail}`.length
  if (room < MIN_TITLE) return `backlog · next: ${clip(first.title, maxLen - 16)}`
  return `backlog · next: ${clip(first.title, room)}${more}${tail}`
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, Math.max(max - 1, 0))}…` : text
}

export const LABELS: Record<Status, string> = { next: 'Next', todo: 'To-do', new: 'New', parked: 'Parked', blocked: 'Blocked' }

/** The summary as plain text: the read-only tool's answer. */
export function reportText(sum: Summary): string {
  if (!sum.found) return 'No BACKLOG.md in the working directory.'
  if (sum.tagged === 0) {
    return `BACKLOG.md has no tagged items (${sum.untagged} untagged). Tag top-level items with [next], [todo], [new], [parked] or [blocked].`
  }
  const lines: string[] = []
  for (const status of STATUSES) {
    const items = sum.byStatus[status]
    if (items.length === 0) continue
    lines.push(`${LABELS[status]} (${items.length}):`, ...items.map(i => `  - ${i.title} (${i.section})`))
  }
  if (sum.untagged > 0) lines.push(`Untagged: ${sum.untagged}`)
  return lines.join('\n')
}
