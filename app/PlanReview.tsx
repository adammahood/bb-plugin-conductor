import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Markdown,
  experimental_Diff as Diff,
  experimental_useRpcQuery as useRpcQuery,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { rpcContract, type PlanMark, type PlanRound } from "../src/contract";
import { lineLabel, splitPlan, type PlanBlock } from "../src/planBlocks";
import {
  ago,
  errorText,
  shortTitle,
  useGo,
  useOpenDecisions,
  usePlanRound,
  usePlanRounds,
  usePlansWaiting,
  useTicketDetail,
} from "./hooks";
import { pickNextUp } from "./nextUp";

type Kind = PlanMark["kind"];

/** What the user selected, before it becomes a mark. */
interface Draft {
  id?: number;
  kind: Kind;
  quote: string;
  startLine: number;
  endLine: number;
  comment: string;
  replacement: string;
  /** Where the editor sits, relative to the plan column. */
  top: number;
}

const KIND_LABELS: Record<Kind, string> = { comment: "Comment", remove: "Remove", replace: "Replace" };
const STATUS_LABELS: Record<PlanRound["status"], string> = {
  open: "waiting on you",
  approved: "approved",
  changes_requested: "changes requested",
  superseded: "superseded by a newer round",
  withdrawn: "closed in the thread",
};

export function PlanReview({ boardId, ticketKey, roundN }: { boardId: number; ticketKey: string; roundN: number | null }) {
  const go = useGo();
  const ticket = useTicketDetail(boardId, ticketKey).data?.detail?.ticket;
  const rounds = usePlanRounds(boardId, ticketKey).data?.rounds;
  const [showDiff, setShowDiff] = useState(false);
  if (!rounds) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (rounds.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {ticketKey} has no plan yet. Its agent sends one with conductor_submit_plan.
      </p>
    );
  }
  const current = rounds.find((r) => r.n === roundN) ?? rounds[0]!;
  const previous = rounds.find((r) => r.n === current.n - 1) ?? null;

  return (
    <div className="space-y-4">
      <style>{PLAN_HIGHLIGHT_CSS}</style>
      <div className="space-y-1">
        <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => go.ticket(boardId, ticketKey)}>
          ← {ticketKey}
        </button>
        <h1 className="text-lg font-semibold">
          {ticketKey} {ticket ? shortTitle(ticket.title) : ""}
        </h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span className={cn(current.status === "open" && "font-medium text-[var(--brand,var(--attention))]")}>
            Plan round {current.n} of {rounds.length}, {STATUS_LABELS[current.status]}
          </span>
          <span>sent {ago(current.submittedAt)}</span>
          {current.source === "inferred" && <span>found in the plans folder</span>}
          <span className="truncate text-xs" title={current.path}>
            {current.path}
          </span>
          <span className="ml-auto flex items-center gap-2">
            <select
              aria-label="Plan round"
              value={current.n}
              onChange={(event) => go.plan(boardId, ticketKey, Number(event.target.value))}
              className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
            >
              {rounds.map((r) => (
                <option key={r.id} value={r.n}>
                  Round {r.n}: {STATUS_LABELS[r.status]}
                </option>
              ))}
            </select>
            {previous && (
              <Button size="sm" variant={showDiff ? "secondary" : "ghost"} onClick={() => setShowDiff(!showDiff)}>
                {showDiff ? "Show the plan" : `Changes since round ${previous.n}`}
              </Button>
            )}
          </span>
        </div>
        {current.summary && <p className="text-sm">{current.summary}</p>}
      </div>
      {showDiff && previous ? <RoundDiff from={previous} to={current} /> : <RoundView round={current} />}
    </div>
  );
}

function RoundDiff({ from, to }: { from: PlanRound; to: PlanRound }) {
  const { data, error } = useRpcQuery({
    contract: rpcContract,
    method: "plans.diff",
    input: { fromRoundId: from.id, toRoundId: to.id },
  });
  if (error) return <p className="text-sm text-destructive">{errorText(error)}</p>;
  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!data.patch.includes("@@")) return <p className="text-sm text-muted-foreground">Round {to.n} is the same as round {from.n}.</p>;
  return <Diff patch={data.patch} path={data.path} view="split" overflow="wrap" />;
}

function RoundView({ round }: { round: PlanRound }) {
  const { data } = usePlanRound(round.id);
  const rpc = useRpc<typeof rpcContract>();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editable = round.status === "open";
  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const run = (work: Promise<unknown>) => {
    setError(null);
    return work.catch((cause) => {
      setError(errorText(cause));
      throw cause;
    });
  };
  const saveDraft = async (d: Draft) => {
    await run(
      rpc.call("plans.mark.save", {
        roundId: round.id,
        ...(d.id ? { id: d.id } : {}),
        kind: d.kind,
        quote: d.quote,
        startLine: d.startLine,
        endLine: d.endLine,
        ...(d.comment.trim() ? { comment: d.comment.trim() } : {}),
        ...(d.kind === "replace" ? { replacement: d.replacement } : {}),
      }),
    );
    setDraft(null);
    window.getSelection()?.removeAllRanges();
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <PlanText
        content={data.content}
        marks={data.marks}
        editable={editable}
        draft={draft}
        onDraft={setDraft}
        onSave={(d) => void saveDraft(d).catch(() => {})}
      />
      <aside className="space-y-4 lg:sticky lg:top-0 lg:self-start">
        <MarksList
          marks={data.marks}
          editable={editable}
          onEdit={(mark) =>
            setDraft({
              id: mark.id,
              kind: mark.kind,
              quote: mark.quote,
              startLine: mark.startLine,
              endLine: mark.endLine,
              comment: mark.comment ?? "",
              replacement: mark.replacement ?? "",
              top: blockTop(mark.startLine),
            })
          }
          onDelete={(mark) => void run(rpc.call("plans.mark.delete", { id: mark.id })).catch(() => {})}
        />
        <Decide round={data.round} marks={data.marks.length} run={run} />
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </aside>
    </div>
  );
}

/** Where a block starts inside the plan column, for placing the editor next to it. */
function blockTop(line: number): number {
  const el = document.querySelector<HTMLElement>(`[data-plan-start="${line}"]`) ?? document.querySelector<HTMLElement>("[data-plan-start]");
  return el ? el.offsetTop : 0;
}

function PlanText({
  content,
  marks,
  editable,
  draft,
  onDraft,
  onSave,
}: {
  content: string;
  marks: PlanMark[];
  editable: boolean;
  draft: Draft | null;
  onDraft: (draft: Draft | null) => void;
  onSave: (draft: Draft) => void;
}) {
  const blocks = useMemo(() => splitPlan(content), [content]);
  const root = useRef<HTMLDivElement>(null);
  const [pick, setPick] = useState<Omit<Draft, "kind" | "comment" | "replacement"> | null>(null);
  useMarkHighlights(root, blocks, marks);

  const onMouseUp = () => {
    if (!editable || !root.current) return;
    const selection = window.getSelection();
    const quote = selection?.toString().trim() ?? "";
    if (!selection || selection.rangeCount === 0 || quote === "") {
      setPick(null);
      return;
    }
    const range = selection.getRangeAt(0);
    const start = blockOf(range.startContainer, root.current);
    const end = blockOf(range.endContainer, root.current);
    if (!start || !end) return;
    // jsdom and some older engines have no Range geometry; the editor then opens at the block.
    const box = typeof range.getBoundingClientRect === "function" ? range.getBoundingClientRect() : null;
    const top = box ? box.bottom - root.current.getBoundingClientRect().top + root.current.scrollTop + 6 : end.offsetTop;
    setPick({ quote, startLine: Number(start.dataset.planStart), endLine: Number(end.dataset.planEnd), top });
  };

  return (
    <div ref={root} className="relative" onMouseUp={onMouseUp}>
      <div className="space-y-3 rounded-xl border border-border bg-card px-6 py-5 text-[15px] leading-relaxed">
        {blocks.map((block) => {
          const marked = marks.some((m) => m.startLine <= block.endLine && m.endLine >= block.startLine);
          return (
            <div
              key={block.startLine}
              data-plan-start={block.startLine}
              data-plan-end={block.endLine}
              className={cn("-ml-3 border-l-2 border-transparent pl-3", marked && "border-[var(--brand,var(--attention))]")}
            >
              <Markdown content={block.source} />
            </div>
          );
        })}
      </div>
      {pick && !draft && (
        <div
          className="absolute left-6 z-10 flex gap-1 rounded-lg border border-border bg-popover p-1 shadow-md"
          style={{ top: pick.top }}
        >
          {(["comment", "remove", "replace"] as const).map((kind) => (
            <Button
              key={kind}
              size="sm"
              variant="ghost"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onDraft({ ...pick, kind, comment: "", replacement: kind === "replace" ? pick.quote : "" });
                setPick(null);
              }}
            >
              {KIND_LABELS[kind]}
            </Button>
          ))}
        </div>
      )}
      {draft && <MarkEditor draft={draft} onChange={onDraft} onSave={onSave} />}
    </div>
  );
}

function blockOf(node: Node, root: HTMLElement): HTMLElement | null {
  const el = node instanceof HTMLElement ? node : node.parentElement;
  const block = el?.closest<HTMLElement>("[data-plan-start]") ?? null;
  return block && root.contains(block) ? block : null;
}

function MarkEditor({ draft, onChange, onSave }: { draft: Draft; onChange: (d: Draft | null) => void; onSave: (d: Draft) => void }) {
  const ready = draft.kind === "comment" ? draft.comment.trim() !== "" : draft.kind === "replace" ? draft.replacement.trim() !== "" : true;
  return (
    <form
      aria-label={`${KIND_LABELS[draft.kind]} mark`}
      className="absolute left-6 right-6 z-20 space-y-2 rounded-lg border border-border bg-popover p-3 shadow-lg"
      style={{ top: draft.top }}
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) onSave(draft);
      }}
    >
      <p className="text-xs text-muted-foreground">
        {KIND_LABELS[draft.kind]} · {lineLabel(draft.startLine, draft.endLine)} · “{truncate(draft.quote, 120)}”
      </p>
      {draft.kind === "replace" && (
        <textarea
          aria-label="Replacement text"
          value={draft.replacement}
          onChange={(event) => onChange({ ...draft, replacement: event.target.value })}
          rows={4}
          className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
        />
      )}
      <textarea
        aria-label={draft.kind === "comment" ? "Comment" : "Why (optional)"}
        placeholder={draft.kind === "comment" ? "Your comment" : "Why (optional)"}
        value={draft.comment}
        onChange={(event) => onChange({ ...draft, comment: event.target.value })}
        rows={3}
        autoFocus
        className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={!ready}>
          {draft.id ? "Save mark" : "Add mark"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => onChange(null)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function MarksList({
  marks,
  editable,
  onEdit,
  onDelete,
}: {
  marks: PlanMark[];
  editable: boolean;
  onEdit: (mark: PlanMark) => void;
  onDelete: (mark: PlanMark) => void;
}) {
  return (
    <section aria-label="Marks" className="space-y-2">
      <h2 className="text-sm font-semibold">
        {marks.length} mark{marks.length === 1 ? "" : "s"}
      </h2>
      {marks.length === 0 && editable && <p className="text-xs text-muted-foreground">Select text in the plan to comment on it, remove it or replace it.</p>}
      {marks.map((mark) => (
        <article key={mark.id} className="space-y-1 rounded-lg border border-border bg-card p-2.5 text-sm">
          <button
            type="button"
            className="block w-full text-left text-xs text-muted-foreground hover:underline"
            onClick={() => document.querySelector(`[data-plan-start="${mark.startLine}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" })}
          >
            {KIND_LABELS[mark.kind]} · {lineLabel(mark.startLine, mark.endLine)}
          </button>
          <p className={cn("text-muted-foreground", mark.kind === "remove" && "line-through")}>“{truncate(mark.quote, 160)}”</p>
          {mark.kind === "replace" && <p className="whitespace-pre-wrap">→ {mark.replacement}</p>}
          {mark.comment && <p className="whitespace-pre-wrap">{mark.comment}</p>}
          {editable && (
            <div className="flex gap-2 text-xs">
              <button type="button" className="hover:underline" onClick={() => onEdit(mark)}>
                Edit
              </button>
              <button type="button" className="text-muted-foreground hover:underline" onClick={() => onDelete(mark)}>
                Delete
              </button>
            </div>
          )}
        </article>
      ))}
    </section>
  );
}

function Decide({ round, marks, run }: { round: PlanRound; marks: number; run: (work: Promise<unknown>) => Promise<unknown> }) {
  const rpc = useRpc<typeof rpcContract>();
  const [overall, setOverall] = useState(round.overallComment ?? "");
  const [busy, setBusy] = useState(false);
  useEffect(() => setOverall(round.overallComment ?? ""), [round.id, round.overallComment]);

  if (round.status !== "open") {
    return (
      <section aria-label="Outcome" className="space-y-1 text-sm">
        {(round.status === "approved" || round.status === "changes_requested") && <UpNext round={round} />}
        <h2 className="font-semibold">Round {round.n}: {STATUS_LABELS[round.status]}</h2>
        {round.overallComment && <p className="whitespace-pre-wrap text-muted-foreground">{round.overallComment}</p>}
        {round.decidedAt && (
          <p className="text-xs text-muted-foreground">
            {round.deliveredAt !== null
              ? `Sent to the agent ${ago(round.deliveredAt)}.`
              : round.deliveryError
                ? `Not delivered: ${round.deliveryError}`
                : round.status === "approved" || round.status === "changes_requested"
                  ? "Sending…"
                  : `Closed ${ago(round.decidedAt)}.`}
          </p>
        )}
        {round.deliveryError && round.deliveredAt === null && (
          <Button size="sm" variant="outline" onClick={() => void run(rpc.call("plans.retryDelivery", { roundId: round.id })).catch(() => {})}>
            Retry
          </Button>
        )}
      </section>
    );
  }

  const decide = (decision: "approved" | "changes_requested") => {
    setBusy(true);
    void run(rpc.call("plans.decide", { roundId: round.id, decision, overallComment: overall }))
      .catch(() => {})
      .finally(() => setBusy(false));
  };
  return (
    <section aria-label="Decide" className="space-y-2">
      <textarea
        aria-label="Overall comment"
        placeholder="Overall comment (optional)"
        value={overall}
        onChange={(event) => setOverall(event.target.value)}
        onBlur={() => void run(rpc.call("plans.comment", { roundId: round.id, comment: overall })).catch(() => {})}
        rows={4}
        className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm"
      />
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => decide("approved")}>
          Approve{marks > 0 ? " with notes" : ""}
        </Button>
        <Button variant="secondary" disabled={busy || (marks === 0 && overall.trim() === "")} onClick={() => decide("changes_requested")}>
          Request changes
        </Button>
      </div>
      <Hint>Your marks and comment go to the agent as one message.</Hint>
    </section>
  );
}

/** After a decision: the next plan waiting, the decisions left, or the way back to the board. */
function UpNext({ round }: { round: PlanRound }) {
  const go = useGo();
  const plans = usePlansWaiting().data?.rounds;
  const decisions = useOpenDecisions().data?.decisions;
  if (!plans || !decisions) return null;
  const next = pickNextUp(plans, decisions, { roundId: round.id, boardId: round.boardId });
  return (
    <div role="region" aria-label="Up next" className="mb-3 space-y-2 rounded-lg border border-border bg-card p-3">
      {next.kind === "plan" && (
        <>
          <p className="text-xs text-muted-foreground">
            Up next{next.more > 0 ? `, then ${next.more} more plan${next.more > 1 ? "s" : ""}` : ""}
          </p>
          <Button className="w-full" onClick={() => go.plan(next.round.boardId, next.round.ticketKey, next.round.n)}>
            Next plan: {next.round.ticketKey} round {next.round.n}
          </Button>
        </>
      )}
      {next.kind === "decisions" && (
        <Button className="w-full" onClick={() => go.board(next.boardId)}>
          Answer {next.count} decision{next.count > 1 ? "s" : ""} on the board
        </Button>
      )}
      {next.kind === "none" && <p className="text-xs text-muted-foreground">Nothing else waits on you.</p>}
      <Button className="w-full" variant={next.kind === "none" ? "default" : "ghost"} onClick={() => go.board(round.boardId)}>
        Back to the board
      </Button>
    </div>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}

function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * Paints marks over the rendered plan with the CSS Custom Highlight API, so
 * bb's Markdown output stays untouched. Without the API, the left border on
 * marked blocks still shows where marks are.
 */
function useMarkHighlights(root: { current: HTMLElement | null }, blocks: PlanBlock[], marks: PlanMark[]) {
  useEffect(() => {
    const registry = (globalThis.CSS as unknown as { highlights?: Map<string, unknown> } | undefined)?.highlights;
    const HighlightCtor = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
    if (!registry || !HighlightCtor || !root.current) return;
    const byKind: Record<Kind, Range[]> = { comment: [], remove: [], replace: [] };
    for (const mark of marks) {
      const range = findQuote(root.current, mark);
      if (range) byKind[mark.kind].push(range);
    }
    for (const kind of Object.keys(byKind) as Kind[]) registry.set(`conductor-${kind}`, new HighlightCtor(...byKind[kind]));
    return () => {
      for (const kind of Object.keys(byKind) as Kind[]) registry.delete(`conductor-${kind}`);
    };
  }, [root, blocks, marks]);
}

/** The first match of a mark's quote inside the blocks its lines cover. */
function findQuote(root: HTMLElement, mark: PlanMark): Range | null {
  const elements = Array.from(root.querySelectorAll<HTMLElement>("[data-plan-start]")).filter(
    (el) => Number(el.dataset.planStart) <= mark.endLine && Number(el.dataset.planEnd) >= mark.startLine,
  );
  const nodes: Text[] = [];
  for (const el of elements) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
  }
  const text = nodes.map((n) => n.data).join("");
  const needle = mark.quote.replace(/\s+/g, " ").trim();
  const flat = text.replace(/\s/g, " ");
  const at = flat.indexOf(needle);
  if (at < 0) return null;
  const range = document.createRange();
  let offset = 0;
  let started = false;
  for (const node of nodes) {
    const end = offset + node.data.length;
    if (!started && at < end) {
      range.setStart(node, at - offset);
      started = true;
    }
    if (started && at + needle.length <= end) {
      range.setEnd(node, at + needle.length - offset);
      return range;
    }
    offset = end;
  }
  return null;
}

/** Highlight colours; `::highlight()` has no Tailwind utility. */
const PLAN_HIGHLIGHT_CSS = `
::highlight(conductor-comment) { background-color: color-mix(in oklab, var(--attention) 30%, transparent); }
::highlight(conductor-remove) { background-color: color-mix(in oklab, var(--destructive) 25%, transparent); text-decoration: line-through; }
::highlight(conductor-replace) { background-color: color-mix(in oklab, var(--timeline-accent) 30%, transparent); }
`;
