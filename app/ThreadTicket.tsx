import {
  UrlLink,
  experimental_DetailRow as DetailRow,
  type ExperimentalThreadContextSegmentInput,
  type ExperimentalThreadContextSegmentProps,
  type ExperimentalThreadInfoProps,
  type PluginThreadHeaderActionProps,
} from "@get-bb/plugin-sdk/app";
import { STAGE_LABELS, useGo, useOpenTicket, useThreadTicket } from "./hooks";
import { DecisionCard } from "./DecisionCard";

/** Rows in the thread Info tab; nothing for threads that are not tickets. */
export function TicketInfoRows({ threadId }: ExperimentalThreadInfoProps) {
  const openTicket = useOpenTicket();
  const { data } = useThreadTicket(threadId);
  const ticket = data?.ticket;
  if (!ticket) return null;
  const open = data.decisions.filter((d) => d.status === "open").length;
  return (
    <>
      <DetailRow label="Ticket" icon="Layers">
        <button type="button" className="truncate text-left hover:underline" onClick={() => openTicket(ticket.boardId, ticket.key)}>
          {ticket.key} {ticket.title}
        </button>
      </DetailRow>
      <DetailRow label="Stage">
        {STAGE_LABELS[ticket.stage]} · {data.role}
        {ticket.milestone ? ` · ${ticket.milestone}` : ""}
      </DetailRow>
      {ticket.linearUrl && (
        <DetailRow label="Linear">
          <UrlLink href={ticket.linearUrl} className="hover:underline">
            {ticket.linearState ?? ticket.key}
          </UrlLink>
        </DetailRow>
      )}
      {open > 0 && <DetailRow label="Decisions">{open} waiting on you</DetailRow>}
    </>
  );
}

export function useIsTicketThread({ threadId }: ExperimentalThreadContextSegmentInput): boolean {
  return Boolean(useThreadTicket(threadId).data?.ticket);
}

/** The composer context row: ticket, stage and open decisions. */
export function TicketSegmentSummary({ threadId, isExpanded, onToggle }: ExperimentalThreadContextSegmentProps) {
  const { data } = useThreadTicket(threadId);
  const ticket = data?.ticket;
  if (!ticket) return null;
  const open = data.decisions.filter((d) => d.status === "open").length;
  return (
    <button
      type="button"
      aria-expanded={isExpanded}
      onClick={onToggle}
      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
    >
      <span className="font-mono text-foreground">{ticket.key}</span>
      <span>· {STAGE_LABELS[ticket.stage]}</span>
      {ticket.planRound?.status === "open" && (
        <span className="font-medium text-amber-700 dark:text-amber-300">· plan round {ticket.planRound.n} waits on you</span>
      )}
      {open > 0 && <span className="font-medium text-amber-700 dark:text-amber-300">· {open} decision{open > 1 ? "s" : ""}</span>}
    </button>
  );
}

/** Expanded below the row: the ticket's open decisions, answerable here. */
export function TicketSegmentDetails({ threadId, isExpanded }: ExperimentalThreadContextSegmentProps) {
  const openTicket = useOpenTicket();
  const go = useGo();
  const { data } = useThreadTicket(threadId);
  if (!isExpanded || !data?.ticket) return null;
  const open = data.decisions.filter((d) => d.status === "open");
  const plan = data.ticket.planRound;
  return (
    <div className="max-h-96 space-y-2 overflow-y-auto py-2">
      {plan?.status === "open" && (
        <button
          type="button"
          className="text-sm font-medium hover:underline"
          onClick={() => go.plan(data.ticket!.boardId, data.ticket!.key, plan.n)}
        >
          Review plan round {plan.n}
        </button>
      )}
      {open.length === 0 ? (
        <p className="text-xs text-muted-foreground">No open decisions for {data.ticket.key}.</p>
      ) : (
        open.map((d) => <DecisionCard key={d.id} decision={d} showTicket={false} compact />)
      )}
      <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => openTicket(data.ticket!.boardId, data.ticket!.key)}>
        Open {data.ticket.key} on its board
      </button>
    </div>
  );
}

/** A compact ticket chip in the thread header. */
export function TicketHeaderChip({ threadId }: PluginThreadHeaderActionProps) {
  const openTicket = useOpenTicket();
  const { data } = useThreadTicket(threadId);
  const ticket = data?.ticket;
  if (!ticket) return null;
  return (
    <button
      type="button"
      title={`${ticket.key} ${ticket.title}: open on its Conductor board`}
      onClick={() => openTicket(ticket.boardId, ticket.key)}
      className="h-7 rounded-md border border-border px-2 font-mono text-xs hover:bg-muted"
    >
      {ticket.key}
    </button>
  );
}
