# Changelog

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
