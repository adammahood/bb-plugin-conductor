import type Database from "better-sqlite3";
import type {
  Decision,
  PlanMark,
  PlanRound,
  PlanRoundStatus,
  PullRequest,
  Role,
  Stage,
  StageEvent,
  Ticket,
} from "./contract";
import { boardOptionsSchema, type BoardOptions } from "./options";

// Append-only: bb hashes each statement and rejects edits to shipped ones.
export const MIGRATIONS = [
  `CREATE TABLE boards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    orchestrator_thread_id TEXT NOT NULL UNIQUE,
    options_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    last_sweep_at INTEGER,
    sweep_error TEXT
  )`,
  `CREATE TABLE tickets (
    board_id INTEGER NOT NULL,
    key TEXT NOT NULL,
    title TEXT NOT NULL,
    repo TEXT,
    project_id TEXT,
    linear_url TEXT,
    linear_issue_id TEXT,
    linear_state TEXT,
    lead_thread_id TEXT NOT NULL,
    environment_id TEXT,
    branch TEXT,
    base TEXT,
    reported_milestone TEXT,
    reported_stage TEXT,
    reported_at INTEGER,
    stage_note TEXT,
    prs_json TEXT NOT NULL DEFAULT '[]',
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (board_id, key)
  )`,
  // A thread can work on several tickets; the primary one is its Linear binding.
  `CREATE TABLE thread_tickets (
    board_id INTEGER NOT NULL,
    thread_id TEXT NOT NULL,
    ticket_key TEXT NOT NULL,
    role TEXT NOT NULL,
    is_primary INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (board_id, thread_id, ticket_key)
  )`,
  `CREATE TABLE decisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    board_id INTEGER NOT NULL,
    ticket_key TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    question TEXT NOT NULL,
    options_json TEXT NOT NULL,
    recommendation TEXT,
    reasoning TEXT NOT NULL,
    blocking INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    answer_choice TEXT,
    answer_note TEXT,
    answered_at INTEGER,
    delivered_at INTEGER,
    delivery_error TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE stage_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    board_id INTEGER NOT NULL,
    ticket_key TEXT NOT NULL,
    stage TEXT NOT NULL,
    note TEXT,
    thread_id TEXT,
    at INTEGER NOT NULL
  )`,
  // Plan review: each round keeps its own copy of the plan, so history and diffs survive edits to the file.
  `CREATE TABLE plan_rounds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    board_id INTEGER NOT NULL,
    ticket_key TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    n INTEGER NOT NULL,
    path TEXT NOT NULL,
    content TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    source TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    summary TEXT,
    overall_comment TEXT,
    submitted_at INTEGER NOT NULL,
    decided_at INTEGER,
    delivered_at INTEGER,
    delivery_error TEXT
  )`,
  `CREATE TABLE plan_marks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    round_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    quote TEXT NOT NULL,
    start_line INTEGER NOT NULL,
    end_line INTEGER NOT NULL,
    comment TEXT,
    replacement TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
];

export interface BoardRecord {
  id: number;
  name: string;
  orchestratorThreadId: string;
  options: BoardOptions;
  createdAt: number;
  lastSweepAt: number | null;
  sweepError: string | null;
}

/** What discovery learns about a ticket; stage and reports are kept. */
export interface DiscoveredTicket {
  key: string;
  title: string;
  repo: string | null;
  projectId: string | null;
  linearUrl: string | null;
  linearIssueId: string | null;
  linearState: string | null;
  leadThreadId: string;
  environmentId: string | null;
  branch: string | null;
  base: string | null;
  implementerThreadIds: string[];
}

export interface NewDecision {
  ticketKey: string;
  threadId: string;
  question: string;
  options: { label: string; detail: string | null }[];
  recommendation: string | null;
  reasoning: string;
  blocking: boolean;
}

export interface ThreadLink {
  boardId: number;
  ticketKey: string;
  role: Role;
  primary: boolean;
}

export type TableName = "tickets" | "thread_tickets" | "decisions" | "stage_events";

interface BoardRow {
  id: number;
  name: string;
  orchestrator_thread_id: string;
  options_json: string;
  created_at: number;
  last_sweep_at: number | null;
  sweep_error: string | null;
}

interface TicketRow {
  board_id: number;
  key: string;
  title: string;
  repo: string | null;
  project_id: string | null;
  linear_url: string | null;
  linear_issue_id: string | null;
  linear_state: string | null;
  lead_thread_id: string;
  environment_id: string | null;
  branch: string | null;
  base: string | null;
  reported_milestone: string | null;
  reported_stage: Stage | null;
  reported_at: number | null;
  stage_note: string | null;
  prs_json: string;
  updated_at: number;
}

interface DecisionRow {
  id: number;
  board_id: number;
  ticket_key: string;
  thread_id: string;
  question: string;
  options_json: string;
  recommendation: string | null;
  reasoning: string;
  blocking: number;
  status: Decision["status"];
  answer_choice: string | null;
  answer_note: string | null;
  answered_at: number | null;
  delivered_at: number | null;
  delivery_error: string | null;
  created_at: number;
}

export function decisionRef(id: number): string {
  return `D-${id}`;
}

/** The tables of all boards: boards, cross-board lookups and the inbox. */
export class Store {
  constructor(
    readonly db: Database.Database,
    readonly now: () => number = Date.now,
  ) {}

  board(id: number): BoardStore {
    return new BoardStore(this, id);
  }

  listBoards(): BoardRecord[] {
    return (this.db.prepare(`SELECT * FROM boards ORDER BY id`).all() as BoardRow[]).map(toBoard);
  }

  getBoard(id: number): BoardRecord | null {
    const row = this.db.prepare(`SELECT * FROM boards WHERE id = ?`).get(id) as BoardRow | undefined;
    return row ? toBoard(row) : null;
  }

  boardForOrchestrator(threadId: string): BoardRecord | null {
    const row = this.db.prepare(`SELECT * FROM boards WHERE orchestrator_thread_id = ?`).get(threadId) as
      | BoardRow
      | undefined;
    return row ? toBoard(row) : null;
  }

  createBoard(input: { name: string; orchestratorThreadId: string; options: BoardOptions; id?: number }): BoardRecord {
    const result = this.db
      .prepare(`INSERT INTO boards (id, name, orchestrator_thread_id, options_json, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(input.id ?? null, input.name, input.orchestratorThreadId, JSON.stringify(input.options), this.now());
    return this.getBoard(Number(result.lastInsertRowid))!;
  }

  updateBoard(id: number, patch: { name?: string; orchestratorThreadId?: string; options?: BoardOptions }): BoardRecord {
    const current = this.getBoard(id);
    if (!current) throw new Error(`No board ${id}.`);
    this.db
      .prepare(`UPDATE boards SET name = ?, orchestrator_thread_id = ?, options_json = ? WHERE id = ?`)
      .run(
        patch.name ?? current.name,
        patch.orchestratorThreadId ?? current.orchestratorThreadId,
        JSON.stringify(patch.options ?? current.options),
        id,
      );
    return this.getBoard(id)!;
  }

  /** Drops a board and everything on it; threads and their work are untouched. */
  removeBoard(id: number): boolean {
    return this.db.transaction(() => {
      this.db.prepare(`DELETE FROM plan_marks WHERE round_id IN (SELECT id FROM plan_rounds WHERE board_id = ?)`).run(id);
      for (const table of ["tickets", "thread_tickets", "decisions", "stage_events", "plan_rounds"]) {
        this.db.prepare(`DELETE FROM ${table} WHERE board_id = ?`).run(id);
      }
      return this.db.prepare(`DELETE FROM boards WHERE id = ?`).run(id).changes === 1;
    })();
  }

  setSweep(boardId: number, error: string | null): void {
    this.db.prepare(`UPDATE boards SET last_sweep_at = ?, sweep_error = ? WHERE id = ?`).run(this.now(), error, boardId);
  }

  /** Every board a thread is on, with its tickets there; the Linear-bound ticket first. */
  threadLinks(threadId: string): ThreadLink[] {
    return (
      this.db
        .prepare(
          `SELECT board_id, ticket_key, role, is_primary FROM thread_tickets WHERE thread_id = ?
           ORDER BY board_id, is_primary DESC, ticket_key`,
        )
        .all(threadId) as { board_id: number; ticket_key: string; role: Role; is_primary: number }[]
    ).map((row) => ({ boardId: row.board_id, ticketKey: row.ticket_key, role: row.role, primary: row.is_primary === 1 }));
  }

  getDecision(id: number): Decision | null {
    const row = this.db.prepare(`SELECT * FROM decisions WHERE id = ?`).get(id) as DecisionRow | undefined;
    return row ? toDecision(row) : null;
  }

  /** The inbox across every board, or one board's when `boardId` is given. */
  listDecisions(filter: { status?: "open"; boardId?: number; ticketKey?: string; threadId?: string }): Decision[] {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (filter.status) {
      where.push("status = ?");
      args.push(filter.status);
    }
    if (filter.boardId !== undefined) {
      where.push("board_id = ?");
      args.push(filter.boardId);
    }
    if (filter.ticketKey) {
      where.push("ticket_key = ?");
      args.push(filter.ticketKey);
    }
    if (filter.threadId) {
      where.push("thread_id = ?");
      args.push(filter.threadId);
    }
    const sql = `SELECT * FROM decisions ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, blocking DESC, id DESC LIMIT 200`;
    return (this.db.prepare(sql).all(...args) as DecisionRow[]).map(toDecision);
  }

  /** Settles an open decision; returns null when it was not open. */
  settleDecision(id: number, status: "answered" | "withdrawn", choice: string | null, note: string | null): Decision | null {
    const result = this.db
      .prepare(
        `UPDATE decisions SET status = ?, answer_choice = ?, answer_note = ?, answered_at = ?
         WHERE id = ? AND status = 'open'`,
      )
      .run(status, choice, note, this.now(), id);
    return result.changes === 1 ? this.getDecision(id) : null;
  }

  markDelivery(id: number, error: string | null): Decision {
    this.db
      .prepare(`UPDATE decisions SET delivered_at = ?, delivery_error = ? WHERE id = ?`)
      .run(error === null ? this.now() : null, error, id);
    return this.getDecision(id)!;
  }

  /** Writes rows column by column, as given; used by the import from Phase Board. */
  insertRows(table: TableName, rows: Record<string, unknown>[]): void {
    for (const row of rows) {
      const columns = Object.keys(row);
      this.db
        .prepare(`INSERT OR REPLACE INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`)
        .run(...columns.map((c) => row[c] as string | number | null));
    }
  }

  getRound(id: number): (PlanRound & { content: string }) | null {
    const row = this.db.prepare(`SELECT * FROM plan_rounds WHERE id = ?`).get(id) as PlanRoundRow | undefined;
    return row ? { ...this.toRound(row), content: row.content } : null;
  }

  /** Open plan rounds, on one board or all of them. */
  waitingRounds(boardId?: number): PlanRound[] {
    const rows = (
      boardId === undefined
        ? this.db.prepare(`SELECT * FROM plan_rounds WHERE status = 'open' ORDER BY submitted_at`).all()
        : this.db.prepare(`SELECT * FROM plan_rounds WHERE status = 'open' AND board_id = ? ORDER BY submitted_at`).all(boardId)
    ) as PlanRoundRow[];
    return rows.map((row) => this.toRound(row));
  }

  marks(roundId: number): PlanMark[] {
    return (
      this.db.prepare(`SELECT * FROM plan_marks WHERE round_id = ? ORDER BY start_line, id`).all(roundId) as PlanMarkRow[]
    ).map(toMark);
  }

  saveMark(input: Omit<PlanMark, "id" | "createdAt"> & { id?: number }): PlanMark {
    const at = this.now();
    if (input.id !== undefined) {
      this.db
        .prepare(
          `UPDATE plan_marks SET kind = ?, quote = ?, start_line = ?, end_line = ?, comment = ?, replacement = ?, updated_at = ?
           WHERE id = ? AND round_id = ?`,
        )
        .run(input.kind, input.quote, input.startLine, input.endLine, input.comment, input.replacement, at, input.id, input.roundId);
      return toMark(this.db.prepare(`SELECT * FROM plan_marks WHERE id = ?`).get(input.id) as PlanMarkRow);
    }
    const result = this.db
      .prepare(
        `INSERT INTO plan_marks (round_id, kind, quote, start_line, end_line, comment, replacement, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(input.roundId, input.kind, input.quote, input.startLine, input.endLine, input.comment, input.replacement, at, at);
    return toMark(this.db.prepare(`SELECT * FROM plan_marks WHERE id = ?`).get(Number(result.lastInsertRowid)) as PlanMarkRow);
  }

  markRoundId(markId: number): number | null {
    const row = this.db.prepare(`SELECT round_id FROM plan_marks WHERE id = ?`).get(markId) as { round_id: number } | undefined;
    return row?.round_id ?? null;
  }

  deleteMark(markId: number): boolean {
    return this.db.prepare(`DELETE FROM plan_marks WHERE id = ?`).run(markId).changes === 1;
  }

  setOverallComment(roundId: number, comment: string | null): void {
    this.db.prepare(`UPDATE plan_rounds SET overall_comment = ? WHERE id = ?`).run(comment, roundId);
  }

  /** Moves an open round to a final status; null when it was not open. */
  closeRound(roundId: number, status: Exclude<PlanRoundStatus, "open">): PlanRound | null {
    const result = this.db
      .prepare(`UPDATE plan_rounds SET status = ?, decided_at = ? WHERE id = ? AND status = 'open'`)
      .run(status, this.now(), roundId);
    return result.changes === 1 ? this.getRound(roundId) : null;
  }

  markRoundDelivery(roundId: number, error: string | null): PlanRound {
    this.db
      .prepare(`UPDATE plan_rounds SET delivered_at = ?, delivery_error = ? WHERE id = ?`)
      .run(error === null ? this.now() : null, error, roundId);
    return this.getRound(roundId)!;
  }

  toRound(row: PlanRoundRow): PlanRound {
    const marks = this.db.prepare(`SELECT COUNT(*) AS n FROM plan_marks WHERE round_id = ?`).get(row.id) as { n: number };
    return {
      id: row.id,
      boardId: row.board_id,
      ticketKey: row.ticket_key,
      threadId: row.thread_id,
      n: row.n,
      path: row.path,
      sha256: row.sha256,
      source: row.source,
      status: row.status,
      summary: row.summary,
      overallComment: row.overall_comment,
      marks: marks.n,
      submittedAt: row.submitted_at,
      decidedAt: row.decided_at,
      deliveredAt: row.delivered_at,
      deliveryError: row.delivery_error,
    };
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
}

/** One board's tickets, links and history. */
export class BoardStore {
  constructor(
    readonly root: Store,
    readonly boardId: number,
  ) {}

  private get db() {
    return this.root.db;
  }

  private now() {
    return this.root.now();
  }

  record(): BoardRecord {
    const board = this.root.getBoard(this.boardId);
    if (!board) throw new Error(`No board ${this.boardId}.`);
    return board;
  }

  upsertDiscovered(found: DiscoveredTicket): void {
    const at = this.now();
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO tickets (board_id, key, title, repo, project_id, linear_url, linear_issue_id,
             linear_state, lead_thread_id, environment_id, branch, base, updated_at)
           VALUES (@boardId, @key, @title, @repo, @projectId, @linearUrl, @linearIssueId,
             @linearState, @leadThreadId, @environmentId, @branch, @base, @at)
           ON CONFLICT(board_id, key) DO UPDATE SET
             title = excluded.title, repo = excluded.repo, project_id = excluded.project_id,
             linear_url = COALESCE(excluded.linear_url, tickets.linear_url),
             linear_issue_id = COALESCE(excluded.linear_issue_id, tickets.linear_issue_id),
             linear_state = COALESCE(excluded.linear_state, tickets.linear_state),
             lead_thread_id = excluded.lead_thread_id, environment_id = excluded.environment_id,
             branch = excluded.branch, base = excluded.base,
             updated_at = CASE WHEN tickets.title IS excluded.title AND tickets.branch IS excluded.branch
               AND tickets.base IS excluded.base AND tickets.linear_state IS excluded.linear_state
               THEN tickets.updated_at ELSE excluded.updated_at END`,
        )
        .run({ ...found, implementerThreadIds: undefined, boardId: this.boardId, at });
      const setRole = this.db.prepare(
        `INSERT INTO thread_tickets (board_id, thread_id, ticket_key, role, is_primary) VALUES (?, ?, ?, ?, 1)
         ON CONFLICT(board_id, thread_id, ticket_key) DO UPDATE SET role = excluded.role, is_primary = 1`,
      );
      // Implementers also serve every extra ticket linked to their lead.
      const extras = this.db
        .prepare(`SELECT ticket_key FROM thread_tickets WHERE board_id = ? AND thread_id = ? AND is_primary = 0`)
        .all(this.boardId, found.leadThreadId) as { ticket_key: string }[];
      const linkExtra = this.db.prepare(
        `INSERT OR IGNORE INTO thread_tickets (board_id, thread_id, ticket_key, role, is_primary) VALUES (?, ?, ?, 'implementer', 0)`,
      );
      setRole.run(this.boardId, found.leadThreadId, found.key, "lead");
      for (const id of found.implementerThreadIds) {
        setRole.run(this.boardId, id, found.key, "implementer");
        for (const extra of extras) linkExtra.run(this.boardId, id, extra.ticket_key);
      }
    })();
  }

  threadTickets(threadId: string): ThreadLink[] {
    return this.root.threadLinks(threadId).filter((link) => link.boardId === this.boardId);
  }

  threadIds(ticketKey: string): string[] {
    return (
      this.db
        .prepare(`SELECT thread_id FROM thread_tickets WHERE board_id = ? AND ticket_key = ? ORDER BY role, thread_id`)
        .all(this.boardId, ticketKey) as { thread_id: string }[]
    ).map((row) => row.thread_id);
  }

  /**
   * Adds a ticket worked in an existing ticket thread (several tickets per
   * thread). The new ticket shares the thread's lead, repo and checkout.
   */
  linkTicket(input: {
    key: string;
    threadId: string;
    title: string | null;
    linearUrl: string | null;
    linearIssueId: string | null;
    linearState: string | null;
  }): void {
    const [link] = this.threadTickets(input.threadId);
    if (!link) throw new Error(`Thread ${input.threadId} is not on the board.`);
    const home = this.row(link.ticketKey)!;
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO tickets (board_id, key, title, repo, project_id, linear_url, linear_issue_id, linear_state,
             lead_thread_id, environment_id, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(board_id, key) DO UPDATE SET
             title = COALESCE(excluded.title, tickets.title),
             linear_url = COALESCE(excluded.linear_url, tickets.linear_url),
             linear_issue_id = COALESCE(excluded.linear_issue_id, tickets.linear_issue_id),
             linear_state = COALESCE(excluded.linear_state, tickets.linear_state)`,
        )
        .run(
          this.boardId,
          input.key,
          input.title ?? input.key,
          home.repo,
          home.project_id,
          input.linearUrl,
          input.linearIssueId,
          input.linearState,
          home.lead_thread_id,
          home.environment_id,
          this.now(),
        );
      const insertLink = this.db.prepare(
        `INSERT OR IGNORE INTO thread_tickets (board_id, thread_id, ticket_key, role, is_primary) VALUES (?, ?, ?, ?, 0)`,
      );
      for (const threadId of this.threadIds(home.key)) {
        insertLink.run(this.boardId, threadId, input.key, threadId === home.lead_thread_id ? "lead" : "implementer");
      }
    })();
  }

  listTickets(): Ticket[] {
    const rows = this.db.prepare(`SELECT * FROM tickets WHERE board_id = ? ORDER BY key`).all(this.boardId) as TicketRow[];
    return rows.map((row) => this.toTicket(row));
  }

  getTicket(key: string): Ticket | null {
    const row = this.row(key);
    return row ? this.toTicket(row) : null;
  }

  linearIssueId(key: string): string | null {
    return this.row(key)?.linear_issue_id ?? null;
  }

  private row(key: string): TicketRow | undefined {
    return this.db.prepare(`SELECT * FROM tickets WHERE board_id = ? AND key = ?`).get(this.boardId, key) as
      | TicketRow
      | undefined;
  }

  reportStage(input: {
    ticketKey: string;
    threadId: string | null;
    stage: Stage | null;
    note: string | null;
    prs: PullRequest[] | null;
    milestone: string | null;
  }): void {
    const at = this.now();
    this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE tickets SET reported_stage = COALESCE(?, reported_stage),
             reported_at = CASE WHEN ? IS NULL THEN reported_at ELSE ? END,
             stage_note = COALESCE(?, stage_note),
             prs_json = COALESCE(?, prs_json),
             reported_milestone = COALESCE(?, reported_milestone),
             updated_at = ? WHERE board_id = ? AND key = ?`,
        )
        .run(
          input.stage,
          input.stage,
          at,
          input.note,
          input.prs === null ? null : JSON.stringify(input.prs),
          input.milestone,
          at,
          this.boardId,
          input.ticketKey,
        );
      this.db
        .prepare(`INSERT INTO stage_events (board_id, ticket_key, stage, note, thread_id, at) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(this.boardId, input.ticketKey, input.stage ?? "note", input.note, input.threadId, at);
    })();
  }

  stageEvents(ticketKey: string): StageEvent[] {
    return (
      this.db
        .prepare(
          `SELECT stage, note, thread_id, at FROM stage_events WHERE board_id = ? AND ticket_key = ?
           ORDER BY at DESC, id DESC LIMIT 50`,
        )
        .all(this.boardId, ticketKey) as { stage: string; note: string | null; thread_id: string | null; at: number }[]
    ).map((row) => ({
      stage: row.stage === "note" ? null : (row.stage as Stage),
      note: row.note,
      threadId: row.thread_id,
      at: row.at,
    }));
  }

  addDecision(input: NewDecision): Decision {
    const result = this.db
      .prepare(
        `INSERT INTO decisions (board_id, ticket_key, thread_id, question, options_json, recommendation,
           reasoning, blocking, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        this.boardId,
        input.ticketKey,
        input.threadId,
        input.question,
        JSON.stringify(input.options),
        input.recommendation,
        input.reasoning,
        input.blocking ? 1 : 0,
        this.now(),
      );
    return this.root.getDecision(Number(result.lastInsertRowid))!;
  }

  listDecisions(filter: { status?: "open"; ticketKey?: string } = {}): Decision[] {
    return this.root.listDecisions({ ...filter, boardId: this.boardId });
  }

  /** A ticket's plan rounds, newest first. */
  planRounds(ticketKey: string): PlanRound[] {
    return (
      this.db
        .prepare(`SELECT * FROM plan_rounds WHERE board_id = ? AND ticket_key = ? ORDER BY n DESC`)
        .all(this.boardId, ticketKey) as PlanRoundRow[]
    ).map((row) => this.root.toRound(row));
  }

  /** Opens the next round for a ticket; an open round before it is superseded. */
  openRound(input: {
    ticketKey: string;
    threadId: string;
    path: string;
    content: string;
    sha256: string;
    source: PlanRound["source"];
    summary: string | null;
  }): PlanRound {
    return this.db.transaction(() => {
      const at = this.now();
      this.db
        .prepare(
          `UPDATE plan_rounds SET status = 'superseded', decided_at = ? WHERE board_id = ? AND ticket_key = ? AND status = 'open'`,
        )
        .run(at, this.boardId, input.ticketKey);
      const last = this.db
        .prepare(`SELECT COALESCE(MAX(n), 0) AS n FROM plan_rounds WHERE board_id = ? AND ticket_key = ?`)
        .get(this.boardId, input.ticketKey) as { n: number };
      const result = this.db
        .prepare(
          `INSERT INTO plan_rounds (board_id, ticket_key, thread_id, n, path, content, sha256, source, summary, submitted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(this.boardId, input.ticketKey, input.threadId, last.n + 1, input.path, input.content, input.sha256, input.source, input.summary, at);
      return this.root.getRound(Number(result.lastInsertRowid))!;
    })();
  }

  private toTicket(row: TicketRow): Ticket {
    const counts = this.db
      .prepare(
        `SELECT COUNT(*) AS open, COALESCE(SUM(blocking), 0) AS blocking FROM decisions
         WHERE board_id = ? AND ticket_key = ? AND status = 'open'`,
      )
      .get(this.boardId, row.key) as { open: number; blocking: number };
    const implementers = (
      this.db
        .prepare(
          `SELECT thread_id FROM thread_tickets WHERE board_id = ? AND ticket_key = ? AND role = 'implementer' ORDER BY thread_id`,
        )
        .all(this.boardId, row.key) as { thread_id: string }[]
    ).map((r) => r.thread_id);
    const sharedWith = (
      this.db
        .prepare(`SELECT key FROM tickets WHERE board_id = ? AND lead_thread_id = ? AND key != ? ORDER BY key`)
        .all(this.boardId, row.lead_thread_id, row.key) as { key: string }[]
    ).map((r) => r.key);
    return {
      boardId: this.boardId,
      key: row.key,
      title: row.title,
      repo: row.repo,
      projectId: row.project_id,
      linearUrl: row.linear_url,
      linearState: row.linear_state,
      leadThreadId: row.lead_thread_id,
      implementerThreadIds: implementers,
      environmentId: row.environment_id,
      branch: row.branch,
      base: row.base,
      milestone: row.reported_milestone,
      stage: row.reported_stage ?? "planning",
      stageSource: row.reported_stage ? "reported" : "inferred",
      reportedStage: row.reported_stage,
      reportedAt: row.reported_at,
      stageNote: row.stage_note,
      sharedWith,
      prs: (JSON.parse(row.prs_json) as Partial<PullRequest>[]).map(normalizePr),
      planRound: this.planRounds(row.key)[0] ?? null,
      openReview: null,
      openDecisions: counts.open,
      blockingDecisions: counts.blocking,
      updatedAt: row.updated_at,
    };
  }
}

interface PlanRoundRow {
  id: number;
  board_id: number;
  ticket_key: string;
  thread_id: string;
  n: number;
  path: string;
  content: string;
  sha256: string;
  source: PlanRound["source"];
  status: PlanRoundStatus;
  summary: string | null;
  overall_comment: string | null;
  submitted_at: number;
  decided_at: number | null;
  delivered_at: number | null;
  delivery_error: string | null;
}

interface PlanMarkRow {
  id: number;
  round_id: number;
  kind: PlanMark["kind"];
  quote: string;
  start_line: number;
  end_line: number;
  comment: string | null;
  replacement: string | null;
  created_at: number;
}

function toMark(row: PlanMarkRow): PlanMark {
  return {
    id: row.id,
    roundId: row.round_id,
    kind: row.kind,
    quote: row.quote,
    startLine: row.start_line,
    endLine: row.end_line,
    comment: row.comment,
    replacement: row.replacement,
    createdAt: row.created_at,
  };
}

function toBoard(row: BoardRow): BoardRecord {
  let raw: unknown = {};
  try {
    raw = JSON.parse(row.options_json);
  } catch {
    // A damaged row falls back to the defaults below.
  }
  const parsed = boardOptionsSchema.safeParse(raw);
  return {
    id: row.id,
    name: row.name,
    orchestratorThreadId: row.orchestrator_thread_id,
    options: parsed.success ? parsed.data : boardOptionsSchema.parse({}),
    createdAt: row.created_at,
    lastSweepAt: row.last_sweep_at,
    sweepError: row.sweep_error,
  };
}

/** Older rows lacked label and allowed a null state. */
function normalizePr(pr: Partial<PullRequest>): PullRequest {
  return {
    repo: pr.repo ?? "",
    number: pr.number ?? null,
    url: pr.url ?? null,
    label: pr.label ?? null,
    base: pr.base ?? null,
    state: pr.state ?? "open",
  };
}

function toDecision(row: DecisionRow): Decision {
  return {
    id: row.id,
    ref: decisionRef(row.id),
    boardId: row.board_id,
    ticketKey: row.ticket_key,
    threadId: row.thread_id,
    question: row.question,
    options: JSON.parse(row.options_json) as Decision["options"],
    recommendation: row.recommendation,
    reasoning: row.reasoning,
    blocking: row.blocking === 1,
    status: row.status,
    answer: row.answered_at === null ? null : { choice: row.answer_choice, note: row.answer_note, at: row.answered_at },
    deliveredAt: row.delivered_at,
    deliveryError: row.delivery_error,
    createdAt: row.created_at,
  };
}
