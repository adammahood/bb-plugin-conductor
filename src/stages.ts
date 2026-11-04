import type { PullRequest, Stage } from "./contract";

/** What the board knows about a ticket when it picks the stage. */
export interface StageFacts {
  reported: Stage | null;
  prs: PullRequest[];
  /** The ticket's live Code Review Workspace round, if any. */
  reviewRound: "needs-review" | "with-agent" | null;
  /** The agent reported its stage after the user sent that round back. */
  reportedAfterReview: boolean;
  /** Status of the ticket's latest plan round (superseded and withdrawn read as none). */
  planRound: "open" | "approved" | "changes_requested" | null;
  agentRunning: boolean;
  /** The tracker has the ticket in a completed state. */
  trackerDone: boolean;
  /** Every merged PR's base branch has reached the repo's default branch. */
  landed: boolean;
}

export interface StageDecision {
  stage: Stage;
  source: "reported" | "inferred";
}

const PIPELINE: Stage[] = [
  "planning",
  "plan-review",
  "building",
  "code-review",
  "draft-pr",
  "in-review",
  "in-milestone",
  "done",
];

/**
 * First matching rule wins: paused, a code review round waiting on the user,
 * a round with the agent (Building), an open plan round, Done in the tracker,
 * In review, In milestone or Done from PR states, the agent's reported stage,
 * then Draft PRs, Building or Planning from the facts. A report beats those last three
 * because an agent with draft PRs is often building the next layer.
 */
export function decideStage(facts: StageFacts): StageDecision {
  const { reported } = facts;
  if (reported === "paused") return { stage: "paused", source: "reported" };
  if (facts.reviewRound === "needs-review") return { stage: "code-review", source: "inferred" };
  // The user's comments are with the agent: it is fixing them until it reports or opens the next round.
  if (facts.reviewRound === "with-agent" && !facts.reportedAfterReview) return { stage: "building", source: "inferred" };
  if (facts.planRound === "open") return { stage: "plan-review", source: "inferred" };
  if (facts.trackerDone) return { stage: "done", source: "inferred" };
  // Plan review means a round waits on the user; without one, a plan-review report reads as planning.
  if (reported === "plan-review" && facts.planRound !== "approved" && facts.prs.length === 0) {
    return { stage: "planning", source: "inferred" };
  }

  const inferred = inferFromWork(facts);
  const settled = inferred === "in-review" || inferred === "in-milestone" || inferred === "done";
  if (reported && reported !== "plan-review" && (!settled || rank(reported) >= rank(inferred))) {
    return { stage: reported, source: "reported" };
  }
  return { stage: inferred, source: "inferred" };
}

function inferFromWork(facts: StageFacts): Stage {
  const pushed = facts.prs.filter((pr) => pr.state !== "local");
  // Held and closed PRs were set aside on purpose and do not hold a ticket back.
  const live = pushed.filter((pr) => pr.state !== "held" && pr.state !== "closed");
  if (live.some((pr) => pr.state === "open")) return "in-review";
  if (live.length > 0 && live.every((pr) => pr.state === "merged")) return facts.landed ? "done" : "in-milestone";
  if (pushed.length > 0) return "draft-pr";
  if (facts.agentRunning || facts.planRound === "approved" || facts.prs.length > 0) return "building";
  return "planning";
}

function rank(stage: Stage): number {
  return PIPELINE.indexOf(stage);
}
