import { describe, expect, it } from "vitest";
import { pickNextUp } from "../app/nextUp";
import type { Decision, PlanRound } from "../src/contract";

const round = (id: number, boardId: number, submittedAt: number, status: PlanRound["status"] = "open"): PlanRound => ({
  id,
  boardId,
  ticketKey: `ABC-${id}`,
  threadId: `thr_${id}`,
  n: 1,
  path: "/p.md",
  sha256: "x",
  source: "submitted",
  status,
  summary: null,
  overallComment: null,
  marks: 0,
  submittedAt,
  decidedAt: null,
  deliveredAt: null,
  deliveryError: null,
});

const decision = (id: number, boardId: number, status: Decision["status"] = "open"): Decision => ({
  id,
  ref: `D-${id}`,
  boardId,
  ticketKey: "ABC-9",
  threadId: "thr_9",
  question: "?",
  options: [],
  recommendation: null,
  reasoning: "",
  blocking: false,
  status,
  answer: null,
  deliveredAt: null,
  deliveryError: null,
  createdAt: 1,
});

describe("pickNextUp", () => {
  const current = { roundId: 1, boardId: 1 };

  it("offers the oldest other plan on this board before plans on other boards", () => {
    const next = pickNextUp([round(1, 1, 5), round(2, 2, 1), round(3, 1, 9), round(4, 1, 7)], [], current);
    expect(next).toMatchObject({ kind: "plan", round: { id: 4 }, more: 2 });
  });

  it("falls back to another board's plan, then to decisions, then to nothing", () => {
    expect(pickNextUp([round(1, 1, 5), round(2, 2, 1)], [], current)).toMatchObject({ kind: "plan", round: { id: 2 }, more: 0 });
    expect(pickNextUp([round(1, 1, 5)], [decision(1, 2), decision(2, 1), decision(3, 1)], current)).toEqual({
      kind: "decisions",
      boardId: 1,
      count: 2,
    });
    expect(pickNextUp([round(1, 1, 5)], [decision(1, 2)], current)).toEqual({ kind: "decisions", boardId: 2, count: 1 });
    expect(pickNextUp([round(1, 1, 5), round(2, 1, 1, "approved")], [decision(1, 1, "answered")], current)).toEqual({ kind: "none" });
  });
});
