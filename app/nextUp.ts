import type { Decision, PlanRound } from "../src/contract";

export type NextUp =
  | { kind: "plan"; round: PlanRound; more: number }
  | { kind: "decisions"; boardId: number; count: number }
  | { kind: "none" };

/**
 * What to work on after deciding a plan, in Waiting on you order: plans
 * first (this board before others, oldest first), then decisions.
 */
export function pickNextUp(
  plans: PlanRound[],
  decisions: Decision[],
  current: { roundId: number; boardId: number },
): NextUp {
  const rest = plans
    .filter((r) => r.id !== current.roundId && r.status === "open")
    .sort((a, b) => Number(b.boardId === current.boardId) - Number(a.boardId === current.boardId) || a.submittedAt - b.submittedAt);
  if (rest.length > 0) return { kind: "plan", round: rest[0]!, more: rest.length - 1 };
  const open = decisions.filter((d) => d.status === "open");
  if (open.length === 0) return { kind: "none" };
  const here = open.filter((d) => d.boardId === current.boardId);
  const boardId = here.length > 0 ? current.boardId : open[0]!.boardId;
  return { kind: "decisions", boardId, count: open.filter((d) => d.boardId === boardId).length };
}
