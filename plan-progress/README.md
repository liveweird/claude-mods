# plan-progress

A Claude Code mod that shows the plan Claude is executing as a live timeline above the prompt:

```
Plan · Checkup 3 · step 3/5: Fix tier A
━━━━━━━━│━━━━━━━━━━━━━│━━━━━━━──────│─────────────────│──────
elapsed 1h12m · step 8m of ~15m · ~45m left · ETA 14:32
```

- the current step, and time elapsed for the whole plan and for that step
- the estimate of every remaining step, with the expected start time of each (in the pane)
- colours: finished steps green, the running step blue (bold for time spent, thin for the rest of its estimate), later steps dim grey, an overrun orange

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install plan-progress --marketplace liveweird/claude-mods
```

Answer `y` to add the marketplace (once), then pick the user scope. It is active at once, and in every later session.

## Use

Claude reports progress through the `plan_progress` tool the mod registers (`start` with steps and minute estimates, `step` on each move, `revise`, `finish`, `clear`). To make it do so by default, add to `~/.claude/CLAUDE.md`:

> When executing a multi-step plan and the `plan_progress` tool (the plan-progress mod) is available, report it: `start` with every step and an estimate in minutes, `step` each time you move on, `revise` when steps or estimates change, `finish` at the end. Skip it for one-step tasks.

- `/plan-progress` opens a pane with the timeline and one row per step.
- `/plan-progress clear` drops the plan.

A finished plan stays on the band for ten minutes, then leaves it.

## Develop

`claude plugin validate .` and `claude plugin test .`; after an edit, `/reload-plugins` in a session that installed it from this folder.
