# experiment-watch

A Claude Code mod that tells you when your setup is put into a Claude Code experiment, and what changed on your machine when it was.

## What it checks

At session start, a minute later, every 10 minutes after that, and whenever the app rebuilds its system prompt:

- **Cached server config** (`~/.claude.json`, `clientDataCacheSlots`): the newest entry for the session's model, for an experiment ID (`data.atis`) or an experiment key (`data.experimentKey`).
- **This session's transcript**: the last `{"type":"atis-latch","atis":"..."}` row. A non-empty value counts, whether it is a hex ID or an opaque `v1.` token.
- **The system prompt**: whether the app built another model's prompt for this model's requests (the engine reports this as `promptModel`).

## How it tells you

- A 15-second notice and a line above the prompt box, with a Dismiss button. It appears once when an experiment starts and again when it ends.
- A system notification, where the terminal supports one.
- `/experiment-check` prints a full report.

## What it says changed

Each time a check finds no experiment, the mod keeps a copy of that model's cached config and of its prompt's section names. When an experiment appears, `/experiment-check` lists what differs from that copy, for example `breezy_horizon added: {"claude-opus-5-5":"claude-opus-4-8"}` or `section corrections added`.

IDs are shown as their first 3 characters, and opaque tokens as a short hash, so the report is safe to paste.

## Limits

- It reads local files and the prompt the app builds. Changes made on Anthropic's servers are not visible to it. "None" means no marker was found, not that nothing is being tested.
- If you were already in an experiment before its first clean check, it has nothing to compare against, and says so.
- Where an organization manages Claude Code, a managed plugin can pass the prompt event on before mods see it. The prompt check then does not run, and the report says the prompt was not seen.
- The field names come from community reports (r/ClaudeCode, November 2026) and from [am-i-nerfed](https://github.com/electricshadows44/am-i-nerfed) (MIT). They are not documented by Anthropic and may change with any release.

## Install

At the prompt of a terminal session:

```
/plugin install experiment-watch --marketplace deny-atk/claude-experiment-watch
```

From a shell:

```
claude plugin install experiment-watch --marketplace deny-atk/claude-experiment-watch
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `deny-atk/claude-experiment-watch`, then Add plugin.

Answer `y` to add the marketplace, then pick a scope.

## Tests

```
claude plugin test .
```
