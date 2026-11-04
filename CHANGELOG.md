# Changelog

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
