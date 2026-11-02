import { useState } from "react";
import { experimental_useRpcMutation as useRpcMutation } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { rpcContract, type Decision, type Ticket } from "../src/contract";
import { archiveLabel, errorText, formatTime, shortTitle, useBoard, useBoardDecisions, useGo } from "./hooks";

/** Every Done ticket on a board, newest first; the board itself shows only the recent ones. */
export function DoneList({ boardId }: { boardId: number }) {
  const go = useGo();
  const board = useBoard(boardId);
  const decisions = useBoardDecisions(boardId).data?.decisions ?? [];
  const [filter, setFilter] = useState("");
  if (board.error) return <p className="text-sm text-destructive">{errorText(board.error)}</p>;
  if (!board.data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const words = filter.trim().toLowerCase();
  const done = board.data.tickets
    .filter((t) => t.stage === "done")
    .sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0) || a.key.localeCompare(b.key, undefined, { numeric: true }));
  const shown = done.filter((t) => !words || `${t.key} ${t.title}`.toLowerCase().includes(words));

  return (
    <>
      <div className="space-y-2">
        <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => go.board(boardId)}>
          ← All tickets
        </button>
        <h1 className="text-lg font-semibold">Done ({done.length})</h1>
        <Input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter by key or title"
          aria-label="Filter done tickets"
          className="max-w-sm"
        />
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">{done.length === 0 ? "No ticket is Done yet." : "No Done ticket matches."}</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {shown.map((t) => (
            <DoneRow key={t.key} ticket={t} decisions={decisions.filter((d) => d.ticketKey === t.key)} />
          ))}
        </ul>
      )}
    </>
  );
}

function DoneRow({ ticket, decisions }: { ticket: Ticket; decisions: Decision[] }) {
  const go = useGo();
  const withdraw = useRpcMutation({ contract: rpcContract, method: "decisions.withdraw" });
  const label = archiveLabel(ticket);
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
      <button type="button" className="font-semibold hover:underline" onClick={() => go.ticket(ticket.boardId, ticket.key)}>
        {ticket.key}
      </button>
      <span className="min-w-0 flex-1 truncate">{shortTitle(ticket.title)}</span>
      {ticket.milestone && <span className="text-xs text-muted-foreground">{ticket.milestone}</span>}
      {label && <span className="text-xs text-muted-foreground">{label}</span>}
      {decisions.length > 0 && (
        <Button
          size="sm"
          variant="outline"
          disabled={withdraw.isPending}
          onClick={() =>
            void Promise.all(decisions.map((d) => withdraw.mutate({ id: d.id, note: "The ticket is Done." }))).catch(() => {})
          }
        >
          Withdraw {decisions.length === 1 ? "decision" : `${decisions.length} decisions`}
        </Button>
      )}
      <span className="w-28 text-right text-xs text-muted-foreground">{ticket.doneAt ? formatTime(ticket.doneAt) : ""}</span>
    </li>
  );
}
