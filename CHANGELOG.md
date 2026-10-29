# Changelog

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
