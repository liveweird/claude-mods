import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { EMPTY, LABELS, STATUSES, parseBacklog, reportText, statusText, summarize } from './parse'

const PANE = 'backlog'
const FILE = 'BACKLOG.md'

const backlog = atom({ plugin: 'backlog', key: 'backlog' } as const, EMPTY)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'backlog', description: "The backlog at a glance: what's next, to-do, new, parked, blocked" })
    await $.tool.register({
      name: 'backlog',
      description:
        "Read-only: the working directory's BACKLOG.md by status tag ([next], [todo], [new], [parked], [blocked]), each item's title and section, and the untagged count.",
      inputSchema: { type: 'object', properties: {} },
    })
    await refresh($)

    return next(e)
  })

  on('tool.call', { tool: 'mcp__backlog__backlog' }, async $ => ({ result: reportText(summarize(await refresh($).catch(() => EMPTY))) }))

  // A git pull or an edit made outside Claude shows on the next prompt; one small file read.
  on('prompt.submit', async ($, e, next) => {
    await refresh($).catch(() => undefined)
    return next(e)
  })

  on('classic.CwdChanged', async ($, e, next) => {
    const ran = await next(e)
    await refresh($).catch(() => undefined)
    return ran
  })

  for (const tool of ['Edit', 'Write'] as const) {
    on('tool.call', { tool }, async ($, e, next) => {
      const ran = await next(e)
      if (isBacklogFile(e.file_path)) await refresh($).catch(() => undefined)
      return ran
    })
  }

  on('command.run', { command: 'backlog' }, async $ => {
    await refresh($)
    await $.ui.open({ id: PANE, title: 'Backlog' })
    return { text: 'Backlog pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const sum = summarize(await read($, backlog))
    if (!sum.found || sum.tagged === 0) return <Text dimColor>{reportText(sum)}</Text>

    return (
      <Box flexDirection="column">
        {STATUSES.filter(s => sum.byStatus[s].length > 0).map(status => {
          const items = sum.byStatus[status]
          const held = status === 'parked' || status === 'blocked'
          return (
            <Box flexDirection="column" marginBottom={1}>
              <Text bold color={status === 'next' ? 'success' : held ? 'warning' : undefined}>
                {LABELS[status]} {items.length}
              </Text>
              {items.map(i => (
                <Text wrap="truncate-end" dimColor={status !== 'next'}>
                  {'  '}
                  {i.title}
                  <Text dimColor> · {i.section}</Text>
                </Text>
              ))}
            </Box>
          )
        })}
        {sum.untagged > 0 ? <Text color="warning">Untagged: {sum.untagged}</Text> : null}
      </Box>
    )
  })
}

function isBacklogFile(path: unknown): boolean {
  return typeof path === 'string' && /(^|[/\\])BACKLOG\.md$/.test(path)
}

/**
 * The main checkout's BACKLOG.md. git's common dir is the main checkout's `.git` from a linked worktree too, so a
 * session working in `.claude/worktrees/<name>` still reads the main file, not the worktree's (older) copy. Outside a
 * git repo, or in a bare/submodule layout, it falls back to the working directory's file.
 */
async function backlogPath($: EngineInterface): Promise<string> {
  const git = await $.process.run(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir']).catch(() => undefined)
  const common = git?.exitCode === 0 ? git.stdout.trim() : ''
  return /[\\/]\.git$/.test(common) ? `${common.slice(0, -'.git'.length)}${FILE}` : FILE
}

async function refresh($: EngineInterface) {
  const text = await $.fs.read(await backlogPath($)).catch(() => undefined)
  const parsed = text === undefined ? EMPTY : parseBacklog(text)
  await update($, backlog, () => parsed)
  $.ui.status(statusText(summarize(parsed)))
  return parsed
}
