# mission-control

A Claude Code plugin that draws a panel above the prompt, showing what the
session is doing and what it is costing.

## What it shows

- **Work in progress.** A row per step of the current turn: the tool used, what
  the call was for, how long it took and its share of the turn. A thin strip
  along the top animates while a turn runs. When the turn ends the summary
  reads "Completed" with the total time, and a segmented bar shows where the
  time went.
- **Session.** Whether Claude runs locally or in the cloud, the session name,
  the working directory (last two folders), any other directories, the worktree
  and branch, and git status (changed files, ahead and behind).
- **Usage.** Current session and weekly limits with the time left until each
  resets, context window use, and how much of the last turn's input came from
  the prompt cache.
- **Clocks.** Conversation time, and a countdown to when the prompt cache
  expires.

## Controls

- A copy button beside the session name, working directory and branch, and paging arrows beside the summary when a turn has more than five steps.
- A compact button beside the Context bar, which runs `/compact` once Claude
  is idle.
- A theme dropdown in the bottom right corner. The choice is remembered across
  sessions. Themes: Forest, Midnight, Graphite, Paper, Ocean, Plum, Ember,
  Slate and Sand.

## Install

Type this at the prompt of a Claude Code terminal session:

```
/plugin install mission-control --marketplace bvur/mission-control
```

Answer `y` to add the marketplace, then choose a scope (user scope loads it in
every session).

## Requirements and limits

- Built and tried in the Claude Code desktop app on Windows. In a terminal
  session the panel falls back to plain text, without icons, animation or
  ticking clocks.
- The lettering is JetBrains Mono, which must be installed on the computer;
  otherwise Consolas or the system monospace font is used.
- The cache countdown assumes a 60-minute prompt cache. Change
  `CACHE_MINUTES` in `hooks/register.tsx` to 5 if your plan uses the
  five-minute cache. The countdown is an estimate: it restarts when a turn
  ends.
- The work-in-progress list shows five numbered steps at a time, with buttons to page back through a longer turn.
- Buttons are drawn by the app, so they keep the app's own
  style on every theme.

## Development

```
claude plugin validate .
claude plugin test .
```

Icons are from [Lucide](https://lucide.dev) (ISC licence).
