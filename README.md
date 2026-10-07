# claude-mods

Claude Code mods (plugins of function hooks), one marketplace:

| Mod | What it shows |
| --- | --- |
| [plan-progress](plan-progress/) | The plan Claude is executing as a live timeline above the prompt: current step, elapsed time, estimates and ETA. |
| [turn-limits](turn-limits/) | Per agent type, how many agent invocations of the session stopped at their turn limit, and their share. |

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install plan-progress --marketplace liveweird/claude-mods
/plugin install turn-limits --marketplace liveweird/claude-mods
```

Answer `y` to add the marketplace (once), then pick the user scope. Each mod is active at once, and in every later
session.

## Develop

Each mod is its own folder with `.claude-plugin/plugin.json`, `hooks/` and `tests/`: `claude plugin validate <mod>` and
`claude plugin test <mod>`. A session that installed from a local clone (`--marketplace ~/Sources/claude-mods`) picks
up edits with `/reload-plugins`.
