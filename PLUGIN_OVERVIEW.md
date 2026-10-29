Run many coding agents from one board.

## What you get

- A board per orchestrator thread: every ticket thread with its stage, PR
  stack, review rounds and whether its agents are running.
- A decision inbox. Agents ask with options and a recommendation; your answer
  goes straight back to the agent that asked.
- The orchestrator and any agent's thread in the side panel, beside the board.
- Rule switches per board for what agents are told, plus your own text.

## How it works

Pick a thread as a board's orchestrator. Every thread it starts with a ticket
key in its title is a ticket. Agents get two tools,
`conductor_ask_decision` and `conductor_report_stage`. Linear and Code Review
Workspace are optional. Everything is stored locally.
