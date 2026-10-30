---
name: conductor
description: Ask the user decisions and report your ticket's stage on their Conductor board. Use in a ticket thread that runs under a Conductor board's orchestrator (or as its implementer), whenever you need the user to decide something or your ticket changes stage or PRs.
---

# Conductor

Conductor is the user's board for the tickets their orchestrator thread runs.
It shows each ticket's stage, PRs, review rounds and issue text, and an inbox
of decisions that wait on the user. Your thread is on a board when the board's
orchestrator started it, or when your lead did.

Your instructions name your board, your ticket and the rules the user turned
on for this board. Follow those rules; this skill only explains the tools.

## Asking the user: `conductor_ask_decision`

- `question`: one decision, readable on its own.
- `options`: 2-5 concrete choices; `detail` says what each one means for the
  code or the product.
- `recommendation`: the label you would pick. `reasoning`: what the user needs
  to decide without reading your thread.
- `blocking: true` only when you cannot go on without the answer. Then end your
  turn right after the tool returns, and do not work around the question.
- `blocking: false`: carry on with your recommendation and change course if the
  answer differs.
- `ticket`: only when your thread works on several tickets.

The answer comes back to your thread as a message:

```
[conductor] D-7 answered
Question: …
Answer: <an option label, or the user's own words>
Note: …
```

`[conductor] D-7 withdrawn by …` means drop the question; ask again only with
new context.

## Sending a plan for review: `conductor_submit_plan`

- Write the plan to a Markdown file in your workspace, the board's plans
  folder or your thread's storage folder, then call the tool with its absolute
  `path` (and `summary`, one line, if useful). End your turn right after.
- The user reads the plan rendered, marks passages (comment, remove, replace)
  and adds an overall comment, then approves or requests changes. The result
  comes back as a message:

```
[conductor] Plan round 2 for ABC-123: changes requested
Plan: /…/plan.md (round 2, sha 1f3c2a9b)

I've reviewed this plan and have 2 pieces of feedback:

## 1. (lines 12–14) Feedback on: "resize on read"
> Use a queue.

## 2. (line 20) Remove: "Add a CDN purge job"
```

- On changes requested, revise the same file and submit it again; each
  submission is a new round. On approval, notes listed under "non-blocking
  notes" are guidance; start building and report the stage `building`.

## Reporting progress: `conductor_report_stage`

Stages: `planning`, `plan-review`, `building`, `code-review`, `draft-pr`,
`in-review`, `in-milestone`, `done`, `paused`. Every field is optional; send
what changed.

- `stage`: `plan-review` while a plan waits on the user, `building` once it is
  approved, `paused` when you stop on purpose, `done` for work with no PR when
  it is finished. The board also reads PR states, review rounds and whether you
  are running, so report what those cannot show.
- `prs`: the ticket's full PR list, bottom of the stack first. Each has `repo`,
  `number`, `url`, optional `base`, and `state` (`draft`, `open`, `merged`,
  `closed`, `held`; default `draft`). Unpushed work is `state: "local"` with a
  `label`, for example "route PR". The list replaces the previous one.
- `milestone`: when your base branch does not show it.
- `note`: one line on what changed, for example "round 2 review open".
- `ticket`: only when your thread works on several tickets.

## For the orchestrator

`bb conductor tickets [--board <id>]` lists a board, `bb conductor decisions`
the inbox. `bb conductor report <ticket> [--thread <id>] [--stage …]
[--pr <repo>#<n>[:state]]… [--milestone …] [--note …]` sets a ticket's facts
the way an agent report would. The user answers decisions on the board;
`bb conductor answer D-7 <choice> [--note …]` does the same from a shell when
they ask you to relay one.
