import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  RUNNING_STATUSES,
  type Board,
  type BoardSummary,
  type Decision,
  type Integrations,
  type NextPr,
  type PullRequest,
  type Review,
  type Role,
  type Stage,
  type Ticket,
  type TicketDetail,
} from "./contract";
import { discoverTickets } from "./discovery";
import { compileRegex, DEFAULT_TICKET_PATTERN, milestoneFor, type BoardOptions } from "./options";
import { linearIssue, linearResolve, reviewsForThreads } from "./peers";
import { decideStage } from "./stages";
import type { BoardStore, NewDecision } from "./store";

export class NotTicketThreadError extends Error {
  constructor(threadId: string) {
    super(
      `Thread ${threadId} is not a ticket thread on a Conductor board. Only the ticket agents under a board's orchestrator, and their implementers, can use this tool; ask in your reply instead.`,
    );
  }
}

interface EngineConfig {
  orchestratorThreadId: string;
  ticketPattern: RegExp;
  /** Server-local folder holding `<date>-<key>-<slug>.md` plan files. */
  plansDir: string | null;
  options: BoardOptions;
}

interface PlanFact {
  file: string;
  writtenAt: number;
  waiting: boolean;
  closed: boolean;
}

type WaitingReview = Review & { ticketKey: string };

/** Facts gathered from bb and other plugins; refreshed by sweeps and thread events. */
interface Facts {
  statuses: Map<string, string>;
  reviews: WaitingReview[];
  plans: Map<string, PlanFact>;
}

const isRunning = (status: string | undefined) =>
  status !== undefined && (RUNNING_STATUSES as readonly string[]).includes(status);

/** One board: discovery, facts and stages for the threads under its orchestrator. */
export class BoardEngine {
  private sweeping: Promise<void> | null = null;
  private facts: Facts = { statuses: new Map(), reviews: [], plans: new Map() };
  private reviewsReadAt = 0;

  constructor(
    private readonly bb: BbPluginApi,
    readonly store: BoardStore,
    private readonly integrations: () => Integrations,
    private readonly onChange: () => void,
  ) {}

  get boardId(): number {
    return this.store.boardId;
  }

  private config(): EngineConfig {
    const board = this.store.record();
    return {
      orchestratorThreadId: board.orchestratorThreadId,
      ticketPattern: compileRegex(board.options.ticketPattern, DEFAULT_TICKET_PATTERN),
      plansDir: board.options.plansDir.trim() || null,
      options: board.options,
    };
  }

  /** Runs one discovery and facts sweep; concurrent callers share it. */
  sweep(): Promise<void> {
    this.sweeping ??= this.runSweep().finally(() => {
      this.sweeping = null;
    });
    return this.sweeping;
  }

  private async runSweep(): Promise<void> {
    const { orchestratorThreadId, ticketPattern } = this.config();
    const root = this.store.root;
    try {
      const result = await discoverTickets(this.bb, this.store, orchestratorThreadId, ticketPattern, {
        linear: this.integrations().linear,
      });
      await this.refreshFacts();
      root.setSweep(this.boardId, result.warning);
    } catch (error) {
      this.bb.log.warn(`sweep board ${this.boardId}: ${String(error)}`);
      root.setSweep(this.boardId, String(error).slice(0, 500));
    }
    this.changed();
  }

  private ticketThreadIds(): string[] {
    const ids = new Set<string>();
    for (const t of this.store.listTickets()) {
      ids.add(t.leadThreadId);
      for (const id of t.implementerThreadIds) ids.add(id);
    }
    return [...ids];
  }

  private async refreshFacts(): Promise<void> {
    const ids = this.ticketThreadIds();
    const statuses = new Map<string, string>();
    for (let i = 0; i < ids.length; i += 200) {
      const batch = ids.slice(i, i + 200);
      for (const thread of await this.bb.sdk.threads.list({ threadIds: batch, limit: 200 })) {
        statuses.set(thread.id, thread.status);
      }
    }
    this.facts.statuses = statuses;
    await this.refreshReviews(ids);
    this.facts.plans = await this.planFacts(this.store.listTickets());
  }

  /**
   * Re-reads open rounds. Code Review Workspace sends no change signal, so
   * reads and reports refresh them instead of waiting for the next sweep.
   */
  private async refreshReviews(ids = this.ticketThreadIds()): Promise<boolean> {
    const reviews = this.integrations().codeReview ? await reviewsForThreads(this.bb, ids) : [];
    // Archived or approved rounds no longer wait on the user.
    const before = this.reviewKey();
    this.facts.reviews = this.assignReviews(
      reviews.filter((r) => r.state === "needs-review" || r.state === "with-agent"),
    );
    this.reviewsReadAt = Date.now();
    return this.reviewKey() !== before;
  }

  private reviewKey(): string {
    return this.facts.reviews.map((r) => `${r.targetKey}:${r.state}:${r.ticketKey}`).sort().join(",");
  }

  /** Re-reads rounds now; true when one moved. */
  async pollReviews(): Promise<boolean> {
    return this.refreshReviews();
  }

  /** Called before serving the board; cheap because the reviews are local. */
  async refreshReviewsIfStale(maxAgeMs = 30_000): Promise<void> {
    if (Date.now() - this.reviewsReadAt > maxAgeMs) await this.refreshReviews();
  }

  /** Assigns each review round to one ticket of the thread that opened it. */
  private assignReviews(reviews: Review[]): WaitingReview[] {
    return reviews.flatMap((review) => {
        const links = this.store.threadTickets(review.threadId);
        if (links.length === 0) return [];
        const ref = (review.gitRef ?? "").toLowerCase();
        const named = links.find((link) => ref.includes(link.ticketKey.toLowerCase()));
      return [{ ...review, ticketKey: (named ?? links[0]!).ticketKey }];
    });
  }

  /**
   * The plan-review fallback for leads that do not report it: a plan file for
   * the ticket, no PRs and no commits past the base, the lead idle, and no
   * message from the user (or the orchestrator relaying them) since the file
   * was written. That reply closes the round; plan files carry no approval mark.
   */
  private async planFacts(tickets: Ticket[]): Promise<Map<string, PlanFact>> {
    const out = new Map<string, PlanFact>();
    const dir = this.config().plansDir;
    if (!dir) return out;
    let files: string[];
    try {
      files = (await readdir(dir)).filter((name) => name.endsWith(".md"));
    } catch {
      return out;
    }
    for (const ticket of tickets) {
      if (ticket.prs.length > 0) continue;
      const tag = `-${ticket.key.toLowerCase().replace(/-/g, "")}-`;
      const file = files.filter((name) => name.includes(tag)).sort().at(-1);
      if (!file) continue;
      try {
        const writtenAt = (await stat(join(dir, file))).mtimeMs;
        const repliedAt = await this.lastReplyAt(ticket.leadThreadId);
        const closed = repliedAt !== null && repliedAt > writtenAt;
        const idle = !isRunning(this.facts.statuses.get(ticket.leadThreadId));
        const waiting = !closed && idle && (await this.noCommits(ticket.environmentId));
        out.set(ticket.key, { file, writtenAt, waiting, closed });
      } catch (error) {
        this.bb.log.warn(`plan facts ${ticket.key}: ${String(error)}`);
      }
    }
    return out;
  }

  private async lastReplyAt(threadId: string): Promise<number | null> {
    const orchestrator = this.config().orchestratorThreadId;
    const events = await this.bb.sdk.threads.events.list({
      threadId,
      order: "desc",
      limit: "50",
      types: ["client/turn/requested"] as never,
    });
    for (const event of events) {
      const data = (event.data ?? {}) as { initiator?: string; senderThreadId?: string | null; source?: string };
      const fromUser = data.initiator === "user" && !data.senderThreadId && data.source !== "spawn";
      if (fromUser || data.senderThreadId === orchestrator) return event.createdAt;
    }
    return null;
  }

  private async noCommits(environmentId: string | null): Promise<boolean> {
    if (!environmentId) return true;
    try {
      const status = (await this.bb.sdk.environments.status({ environmentId })) as {
        mergeBase?: { aheadCount?: number } | null;
      };
      return (status.mergeBase?.aheadCount ?? 0) === 0;
    } catch {
      return true;
    }
  }

  /** Keeps agent status live between sweeps. */
  async threadStatusChanged(threadId: string, status: string): Promise<void> {
    if (this.store.threadTickets(threadId).length === 0) return;
    this.facts.statuses.set(threadId, status);
    if (!isRunning(status)) {
      const leading = this.store.listTickets().filter((t) => t.leadThreadId === threadId);
    if (leading.length === 0 && this.store.threadTickets(threadId).length === 0) return;
      for (const [key, fact] of await this.planFacts(leading)) this.facts.plans.set(key, fact);
    }
    this.changed();
  }

  private withStage(ticket: Ticket): Ticket {
    const plan = this.facts.plans.get(ticket.key) ?? null;
    // A round waiting on the user outranks one already with the agent.
    const rounds = this.facts.reviews.filter((r) => r.ticketKey === ticket.key);
    const review = rounds.find((r) => r.state === "needs-review") ?? rounds[0] ?? null;
    const running = [ticket.leadThreadId, ...ticket.implementerThreadIds].some((id) =>
      isRunning(this.facts.statuses.get(id)),
    );
    const decision = decideStage({
      reported: ticket.reportedStage,
      prs: ticket.prs,
      reviewRound: review ? (review.state as "needs-review" | "with-agent") : null,
      reportedAfterReview: (ticket.reportedAt ?? 0) > (review?.sentAt ?? Infinity),
      planWaiting: plan?.waiting ?? false,
      planClosed: plan?.closed ?? false,
      agentRunning: running,
    });
    return {
      ...ticket,
      milestone: ticket.milestone ?? milestoneFor(this.config().options, ticket.base),
      stage: decision.stage,
      stageSource: decision.source,
      plan: plan ? { file: plan.file, writtenAt: plan.writtenAt } : null,
      openReview: review
        ? { targetKey: review.targetKey, gitRef: review.gitRef, state: review.state as "needs-review" | "with-agent" }
        : null,
    };
  }

  summary(): BoardSummary {
    const board = this.store.record();
    return {
      id: board.id,
      name: board.name,
      orchestratorThreadId: board.orchestratorThreadId,
      options: board.options,
      openDecisions: this.store.listDecisions({ status: "open" }).length,
      tickets: this.store.listTickets().length,
    };
  }

  board(): Board {
    const record = this.store.record();
    const tickets = this.store.listTickets().map((t) => this.withStage(t));
    return {
      board: this.summary(),
      integrations: this.integrations(),
      tickets,
      reviewsWaiting: this.facts.reviews.filter((r) => r.state === "needs-review"),
      nextPr: record.options.rules.onePrAtATime ? nextPrToOpen(tickets) : null,
      lastSweepAt: record.lastSweepAt,
      sweepError: record.sweepError,
    };
  }

  async detail(key: string): Promise<TicketDetail | null> {
    const stored = this.store.getTicket(key);
    if (!stored) return null;
    const issueId = this.store.linearIssueId(key);
    const [linear, reviews] = await Promise.all([
      issueId && this.integrations().linear ? linearIssue(this.bb, issueId) : Promise.resolve(null),
      this.integrations().codeReview ? reviewsForThreads(this.bb, this.store.threadIds(key)) : Promise.resolve([]),
    ]);
    return {
      ticket: this.withStage(stored),
      decisions: this.store.listDecisions({ ticketKey: key }),
      stageEvents: this.store.stageEvents(key),
      reviews: this.assignReviews(reviews)
        .filter((r) => r.ticketKey === key)
        .map(({ ticketKey: _, ...review }) => review),
      linear,
    };
  }

  threadView(threadId: string): { ticket: Ticket | null; role: Role | null; decisions: Decision[] } {
    const [link] = this.store.threadTickets(threadId);
    if (!link) return { ticket: null, role: null, decisions: [] };
    const ticket = this.store.getTicket(link.ticketKey);
    return {
      ticket: ticket ? this.withStage(ticket) : null,
      role: link.role,
      decisions: this.store.listDecisions({ ticketKey: link.ticketKey }),
    };
  }

  /**
   * The ticket a call is about: the named one (linking it to the thread when
   * the thread works on several tickets), else the thread's own ticket.
   */
  private async ticketFor(threadId: string, key: string | null): Promise<string> {
    let links = this.store.threadTickets(threadId);
    if (links.length === 0) {
      await this.sweep();
      links = this.store.threadTickets(threadId);
    }
    if (links.length === 0) throw new NotTicketThreadError(threadId);
    if (!key) return links[0]!.ticketKey;
    const wanted = key.trim().toUpperCase();
    if (links.some((link) => link.ticketKey === wanted)) return wanted;
    if (!this.config().ticketPattern.test(wanted)) {
      throw new Error(`"${key}" does not look like a ticket key.`);
    }
    const linear = this.integrations().linear
      ? (await linearResolve(this.bb, [wanted], threadId)).get(wanted)
      : undefined;
    this.store.linkTicket({
      key: wanted,
      threadId,
      title: linear?.title ?? null,
      linearUrl: linear?.url ?? null,
      linearIssueId: linear?.issueId || null,
      linearState: linear?.stateName ?? null,
    });
    return wanted;
  }

  async ask(
    threadId: string,
    input: Omit<NewDecision, "ticketKey" | "threadId"> & { ticket?: string | null },
  ): Promise<Decision> {
    const { ticket, ...rest } = input;
    const ticketKey = await this.ticketFor(threadId, ticket ?? null);
    const decision = this.store.addDecision({ ...rest, ticketKey, threadId });
    this.changed();
    return decision;
  }

  /** From an agent's thread, or from the CLI with `threadId` null for a known ticket. */
  async reportStage(
    threadId: string | null,
    input: {
      ticket: string | null;
      stage: Stage | null;
      note: string | null;
      prs: PullRequest[] | null;
      milestone: string | null;
    },
  ): Promise<Ticket> {
    let ticketKey: string;
    if (threadId) {
      ticketKey = await this.ticketFor(threadId, input.ticket);
    } else {
      ticketKey = (input.ticket ?? "").trim().toUpperCase();
      if (!this.store.getTicket(ticketKey)) {
        throw new Error(`No ticket ${ticketKey} on the board; pass the thread it is worked in.`);
      }
    }
    this.store.reportStage({ ...input, ticketKey, threadId });
    await this.refreshReviews();
    const ticket = this.store.getTicket(ticketKey)!;
    this.facts.plans.delete(ticketKey);
    for (const [key, fact] of await this.planFacts([ticket])) this.facts.plans.set(key, fact);
    this.changed();
    return this.withStage(ticket);
  }

  private changed(): void {
    this.onChange();
  }
}

/**
 * One PR open for review at a time: after a PR that is open for review, the next
 * draft in the same stack; with none open, the first draft on the board.
 */
export function nextPrToOpen(tickets: Ticket[]): NextPr | null {
  const ordered = [...tickets].sort(
    (a, b) => (a.milestone ?? "~").localeCompare(b.milestone ?? "~") || a.key.localeCompare(b.key),
  );
  const pick = (ticket: Ticket, pr: PullRequest, after: PullRequest | null): NextPr => ({
    ticketKey: ticket.key,
    repo: pr.repo,
    number: pr.number!,
    url: pr.url,
    after: after ? { number: after.number!, url: after.url } : null,
  });
  for (const ticket of ordered) {
    const open = ticket.prs.findIndex((pr) => pr.state === "open" && pr.number !== null);
    if (open < 0) continue;
    const next = ticket.prs.slice(open + 1).find((pr) => pr.state === "draft" && pr.number !== null);
    if (next) return pick(ticket, next, ticket.prs[open]!);
  }
  if (tickets.some((t) => t.prs.some((pr) => pr.state === "open"))) return null;
  for (const ticket of ordered) {
    if (ticket.stage === "paused") continue;
    const draft = ticket.prs.find((pr) => pr.state === "draft" && pr.number !== null);
    if (draft) return pick(ticket, draft, null);
  }
  return null;
}
