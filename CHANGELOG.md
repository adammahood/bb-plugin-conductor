# Changelog

## 0.5.1

- Plans wait for answers: `conductor_submit_plan` refuses a plan while the ticket has open decisions, naming them and telling the agent to fold the answers in first.
- Withdraw a plan round: the new `conductor_withdraw_plan` tool and `bb conductor withdraw-plan <key> [--note]` take an open round off the board and put the ticket back in Planning.
- An agent that asks a decision while its plan round is open withdraws the round, so you never review a plan that is about to change. The ticket's history says why.
- The plan rule and the agent skill say: decisions first, then the plan; any answer folded in means a new round. The skill also documents the Blocked stage.

## 0.5.0

- New Blocked stage. Agents report `blocked` with `blockedBy` (up to 5 ticket keys) and the reason as the note, or just a note for outside work; `bb conductor report <key> --stage blocked --blocked-by <key> --note ...` does the same. Any other stage clears it.
- Blocked tickets get their own section on the board, apart from Building. The card names what the ticket waits on, links to those tickets and shows how each moved since.
- When a blocking ticket is Done, the card says so with a **Tell the agent** button. New board setting "Tell blocked agents automatically when their blocker is Done" (off by default) sends that message once every blocking ticket is Done.
- A code review or plan round waiting on you, and Done in Linear, still show ahead of Blocked. Next PR to open skips Blocked tickets.
- The "Report stages" agent rule tells agents to report blocked with the blocking key and end their turn.

## 0.4.2

- A submitted plan round is never superseded by the plans folder. When the agent edits the file after submitting, the round keeps the copy you review and says the file changed; the agent's next submission opens the next round.
- The plans folder opens rounds only for tickets whose agent never submitted a plan. Editing that file refreshes the open round in place, unless you already marked it up.
- Messages relayed from other threads, such as the orchestrator's, no longer close a round. Only your decision, your own reply in the agent's thread (for a round found in the plans folder) or the agent's resubmission does.
- A ticket shows Plan review only while a round waits on you; a plan-review report without one reads as Planning.

## 0.4.1

- Archiving no longer keeps a merged ticket as "branch not on the remote" after GitHub deleted its branch: when the worktree's commit is the head of one of the ticket's merged PRs, it counts as pushed. Commits GitHub never received still keep the ticket.

## 0.4.0

- Done tickets leave the board after a few days (3 by default) or once their threads are archived, and the sidebar lists only open tickets. A filterable Done list, from the board or the sidebar's "Done (N)" row, keeps every Done ticket with its history.
- Done tickets' decisions, plans and review rounds no longer count in the badge, the inbox or Waiting on you.
- New board setting "Archive a ticket's threads when it's Done" (off by default). It archives a Done ticket's lead and implementer threads only when no PR is open, the agents are idle, nothing waits on you and every worktree is clean and pushed. Otherwise the ticket shows why it is kept.
- Unarchive on a ticket brings its threads back and rebuilds removed worktrees. `bb conductor unarchive <key>` does the same.
- The ticket's history records when it became Done and when its threads were archived or unarchived, including by hand in bb.
- `bb conductor tickets` lists open tickets; `--done` or `--all` shows the rest.
- Fix: the plans-folder fallback read a worktree's commit count from the wrong field, so it always thought a worktree had no commits.

## 0.3.1

- Tickets move from In milestone to Done once their merged PRs reach the default branch: the milestone's release PR merged after them, or the milestone branch is an ancestor of the default branch. Needs `gh` logged in on the bb server.
- Tickets are Done when Linear has the issue in a completed state, even with a held or draft PR left open.
- Held and closed PRs no longer keep a ticket out of In milestone.
- Linear state is read on every sweep, also for tickets without a thread binding of their own.

## 0.3.0

- Plan review: `conductor_submit_plan`, a review page with comment, remove and replace marks, approve (with notes) or request changes, round history and a diff between revisions.
- Plan rounds join decisions in Waiting on you, the inbox, the badge and the thread row icon.
- A waiting plan in the plans folder opens a round on its own.
- The "Plan rounds" rule now tells agents to submit plan files.
- After you approve a plan or request changes, an Up next bar offers the next waiting plan, the board's open decisions, or the way back to the board.
- A plan's YAML front matter shows as a code block.
- A custom Conductor icon in the rail and the plugin list, by Andrew Bird (#1).

## 0.2.2

- README screenshots from a demo board.

## 0.2.1

- Fix installing from git: the frontend no longer needs the plugin SDK package at runtime, which git installs leave out.

## 0.2.0

- Renamed from Phase Board to Conductor (plugin id `conductor`, CLI `bb conductor`, tools `conductor_ask_decision` and `conductor_report_stage`).
- Boards: one per orchestrator thread, several per bb, started from a thread's menu, the board page or the CLI.
- Per-board settings: ticket key pattern, milestones from branch names, plans folder, GitHub owner, your name for agents, rule switches and your own agent rules.
- Works without the Linear and Code Review Workspace plugins.
- `bb conductor import-phase-board` moves a Phase Board install's data, and the old `pb_*` tool names keep working for agents started before the rename.

## 0.1.0

- Phase Board: decision inbox, ticket board by stage, PR stacks, review rounds, the orchestrator in the side panel.
