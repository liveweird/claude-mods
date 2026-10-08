import { expect, test } from 'claude-code/testing'

import { parseBacklog, reportText, statusText, summarize, titleOf } from '../hooks/parse'

const MD = [
  '# Product backlog',
  '',
  'Status tags: [next], [todo], [new], [parked], [blocked].',
  '- [README.md](README.md);',
  '',
  '## Next: the real Jira',
  '',
  '- [next] **Real-Jira first sync.** Backfill 24 months, then read the profile.',
  '  - [todo] a nested bullet belongs to its parent',
  '',
  '## Engineering follow-ups (record: `audit-status.md`)',
  '',
  '- [todo] **Data profile: multi-project boards.** A board whose filter spans projects…',
  '- [TODO] Cache the profile query. It is slow at scale.',
  '- [new] **Cache validators for reports.**',
  '- [parked] **D6 — de-Jira the Connector seam.** Not before GitLab.',
  '- [blocked] **A1 — protect master.** The user decides.',
  '- An untagged item.',
  '',
  '```markdown',
  '- [todo] **An example in a fence.**',
  '```',
].join('\n')

const PANE = {
  plugin: 'backlog',
  component: 'Pane',
  requestId: 'backlog',
  props: { title: 'Backlog', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

test('the parser reads tagged top-level items under sections only', () => {
  const b = parseBacklog(MD)
  expect(b.items.map(i => [i.status, i.title, i.section])).toEqual([
    ['next', 'Real-Jira first sync', 'Next: the real Jira'],
    ['todo', 'Data profile: multi-project boards', 'Engineering follow-ups'],
    ['todo', 'Cache the profile query', 'Engineering follow-ups'],
    ['new', 'Cache validators for reports', 'Engineering follow-ups'],
    ['parked', 'D6 — de-Jira the Connector seam', 'Engineering follow-ups'],
    ['blocked', 'A1 — protect master', 'Engineering follow-ups'],
  ])
  expect(b.untagged).toBe(1)
  expect(titleOf('x'.repeat(80))).toHaveLength(60)
})

test('the status line shows the first next item and the non-zero counts, within its length', () => {
  const sum = summarize(parseBacklog(MD))
  expect(statusText(sum)).toBe('backlog · next: Real-Jira first sync · 2 to-do · 1 new · 2 parked/blocked')
  const short = statusText(sum, 60) ?? ''
  expect(short.length).toBeLessThanOrEqual(60)
  expect(short.startsWith('backlog · next: Real-Jira')).toBe(true)
  expect(statusText(summarize(parseBacklog('## A\n- [todo] **One.**\n- [new] Two')))).toBe('backlog · 1 to-do · 1 new')
  expect(statusText(summarize(parseBacklog('## A\n- [next] **One.**\n- [next] **Two.**')))).toBe('backlog · next: One +1')
  expect(statusText(summarize(parseBacklog('## A\n- untagged')))).toBeUndefined()
  expect(statusText(summarize({ found: false, items: [], untagged: 0 }))).toBeUndefined()
  expect(statusText(summarize(parseBacklog('')))).toBeUndefined()
})

test('the report lists every status with titles and sections', () => {
  const text = reportText(summarize(parseBacklog(MD)))
  expect(text).toContain('Next (1):\n  - Real-Jira first sync (Next: the real Jira)')
  expect(text).toContain('Parked (1):')
  expect(text).toContain('Untagged: 1')
  expect(reportText(summarize({ found: false, items: [], untagged: 0 }))).toBe('No BACKLOG.md in the working directory.')
})

const RUN = { stderr: '', isStdoutTruncated: false, isStderrTruncated: false }

test('the status line, the tool and the pane follow BACKLOG.md', async ($, on) => {
  let file: string | undefined = MD
  // Not a git repo: the working directory's BACKLOG.md.
  on('process.run', () => ({ value: { ...RUN, exitCode: 128, stdout: '' } }))
  on('fs.read', (_$, e) => {
    return e.path.endsWith('/BACKLOG.md') && file !== undefined ? { value: file } : { deny: 'ENOENT' }
  })
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  const statuses: (string | undefined)[] = []
  on('ui.status', (_$, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })

  await $.prompt.submit({ text: 'hi', wait: false, origin: { kind: 'composer' } })
  expect(statuses.at(-1)).toBe('backlog · next: Real-Jira first sync · 2 to-do · 1 new · 2 parked/blocked')

  const report = await $.tool.call({ tool: 'mcp__backlog__backlog' })
  expect(report.result).toContain('Blocked (1):\n  - A1 — protect master (Engineering follow-ups)')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /^Next 1$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Parked 1$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Untagged: 1$/ })).toBeDefined()
    await ui.unmount()
  }

  file = undefined
  await $.prompt.submit({ text: 'again', wait: false, origin: { kind: 'composer' } })
  expect(statuses.at(-1)).toBeUndefined()
})

test('a session in a linked worktree reads the main checkout\'s BACKLOG.md', async ($, on) => {
  const read: string[] = []
  on('process.run', (_$, e) => {
    expect(e.argv).toEqual(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'])
    return { value: { ...RUN, exitCode: 0, stdout: '/repo/.git\n' } }
  })
  on('fs.read', (_$, e) => {
    read.push(e.path)
    return e.path === '/repo/BACKLOG.md' ? { value: '## A\n- [todo] **Main.**' } : { value: '## A\n- [todo] **Worktree copy.**' }
  })
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  const statuses: (string | undefined)[] = []
  on('ui.status', (_$, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })

  await $.prompt.submit({ text: 'hi', wait: false, origin: { kind: 'composer' } })

  expect(read.at(-1)).toBe('/repo/BACKLOG.md')
  expect(statuses.at(-1)).toBe('backlog · 1 to-do')
  const report = await $.tool.call({ tool: 'mcp__backlog__backlog' })
  expect(report.result).toContain('Main')
})
