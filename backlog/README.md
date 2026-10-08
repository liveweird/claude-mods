# backlog

A Claude Code mod that summarises the repository's `BACKLOG.md`: what's next, and how many items are to-do, new
(proposed, not yet confirmed), parked or blocked.

- Status line: `backlog · next: Real-Jira first sync · 9 to-do · 2 new · 3 parked/blocked`
- `/backlog` opens a pane: each status with its items' titles and the `##` section they sit under, plus an untagged count.
- `backlog`: a read-only tool, so Claude can answer "what's next?" without reading the file.

It refreshes at session start, on every prompt (so a `git pull` shows), after an Edit or Write to `BACKLOG.md`, on a
working-directory change and on `/backlog`. A repo without `BACKLOG.md`, or with no tagged items, shows nothing.

It always reads the **main checkout's** `BACKLOG.md` (via `git rev-parse --git-common-dir`), so a session working in a
linked worktree, such as `.claude/worktrees/<name>`, still shows the trunk's backlog, not the worktree's copy. Outside a
git repo it reads the working directory's file.

## The convention

Tag each top-level item under a `##` section at its start; the topic sections stay as they are:

```markdown
## Engineering follow-ups

- [todo] **Data profile: multi-project boards.** A board whose filter spans several projects …
- [parked] **D6 — de-Jira the Connector seam.** Not before the GitLab connector.
- [new] **Cache the profile query.** …
```

- Tags: `[next]`, `[todo]`, `[new]`, `[parked]`, `[blocked]` (case-insensitive).
- The title is the item's first `**bold**` run, else its first sentence.
- Nested bullets belong to their parent; bullets before the first `##` and inside code fences are not items.
- An untagged top-level bullet is counted as untagged, so a forgotten tag shows up in the pane.

`[new]` is for items Claude proposes; the person promotes them to `[todo]` or `[next]`.

## Install

```
/plugin install backlog --marketplace liveweird/claude-mods
```

Answer `y`, pick the user scope. Develop with `claude plugin validate .` and `claude plugin test .` in this folder, then
`/reload-plugins`.
