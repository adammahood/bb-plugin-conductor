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
 * a round with the agent (Building), an open plan round, In review or In
 * milestone from PR states, the agent's reported stage, then Draft PRs,
 * Building or Planning from the facts. A report beats those last three
 * because an agent with draft PRs is often building the next layer.
 */
export function decideStage(facts: StageFacts): StageDecision {
  const { reported } = facts;
  if (reported === "paused") return { stage: "paused", source: "reported" };
  if (facts.reviewRound === "needs-review") return { stage: "code-review", source: "inferred" };
  // The user's comments are with the agent: it is fixing them until it reports or opens the next round.
  if (facts.reviewRound === "with-agent" && !facts.reportedAfterReview) return { stage: "building", source: "inferred" };
  if (facts.planRound === "open") return { stage: "plan-review", source: "inferred" };
  if (reported === "plan-review") {
    if (facts.planRound === "changes_requested") return { stage: "planning", source: "inferred" };
    if (facts.planRound === null && facts.prs.length === 0) return { stage: "plan-review", source: "reported" };
  }

  const inferred = inferFromWork(facts);
  const settled = inferred === "in-review" || inferred === "in-milestone";
  if (reported && reported !== "plan-review" && (!settled || rank(reported) >= rank(inferred))) {
    return { stage: reported, source: "reported" };
  }
  return { stage: inferred, source: "inferred" };
}

function inferFromWork(facts: StageFacts): Stage {
  const pushed = facts.prs.filter((pr) => pr.state !== "local");
  if (pushed.some((pr) => pr.state === "open")) return "in-review";
  if (pushed.length > 0 && pushed.every((pr) => pr.state === "merged")) return "in-milestone";
  if (pushed.length > 0) return "draft-pr";
  if (facts.agentRunning || facts.planRound === "approved" || facts.prs.length > 0) return "building";
  return "planning";
}

function rank(stage: Stage): number {
  return PIPELINE.indexOf(stage);
}
