# turn-limits

A Claude Code mod that counts, per agent type, the agent invocations of the current session that stopped at their
turn limit (`maxTurns`), and what share of that type's invocations they are.

- Status line, once there is a hit: `turn limits 3/21 (14%) · scout 2 · implementer 1`
- `/turn-limits` opens a pane: one row per agent type, `hits/runs`, `%`, and the limits seen.
- `/turn-limits reset` zeroes the counters.
- `turn_limits`: a read-only tool, so Claude can report the numbers.

An invocation is one Agent call; a resumed agent that stops at its limit again still counts once. The count is read
from Claude Code's own notice ("stopped at its N-turn limit"), so it covers built-in agents and agents without a
`maxTurns` of their own too.

## Install

```
/plugin install turn-limits --marketplace liveweird/claude-mods
```

Answer `y`, pick the user scope. Develop with `claude plugin validate .` and `claude plugin test .` in this folder, then
`/reload-plugins`.
