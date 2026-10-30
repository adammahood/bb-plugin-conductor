import { describe, expect, it } from "vitest";
import type { PullRequest } from "../src/contract";
import { boardOptionsSchema, milestoneFor } from "../src/options";
import { decideStage, type StageFacts } from "../src/stages";

const pr = (number: number, state: PullRequest["state"]): PullRequest => ({
  repo: "media-jobs",
  number,
  url: `https://github.com/acme/media-jobs/pull/${number}`,
  label: null,
  base: null,
  state,
});

const facts = (overrides: Partial<StageFacts> = {}): StageFacts => ({
  reported: null,
  prs: [],
  reviewRound: null,
  reportedAfterReview: false,
  planRound: null,
  agentRunning: false,
  ...overrides,
});

describe("decideStage", () => {
  it("starts in planning", () => {
    expect(decideStage(facts())).toMatchObject({ stage: "planning", source: "inferred" });
  });

  it("is building while an agent runs or once the plan round closed", () => {
    expect(decideStage(facts({ agentRunning: true })).stage).toBe("building");
    expect(decideStage(facts({ planRound: "approved" })).stage).toBe("building");
  });

  it("reads PR states: drafts, then open for review, then all merged", () => {
    expect(decideStage(facts({ prs: [pr(56, "draft"), pr(57, "held")] })).stage).toBe("draft-pr");
    expect(decideStage(facts({ prs: [pr(49, "merged"), pr(50, "open"), pr(51, "draft")] })).stage).toBe("in-review");
    expect(decideStage(facts({ prs: [pr(38, "merged")] })).stage).toBe("in-milestone");
  });

  it("ignores work that is not pushed when deciding all PRs are merged", () => {
    const local: PullRequest = { repo: "x", number: null, url: null, label: "route PR", base: null, state: "local" };
    expect(decideStage(facts({ prs: [pr(76, "merged"), local] })).stage).toBe("in-milestone");
    expect(decideStage(facts({ prs: [local] })).stage).toBe("building");
  });

  it("shows plan review while a plan round waits on the user", () => {
    expect(decideStage(facts({ planRound: "open" }))).toMatchObject({ stage: "plan-review", source: "inferred" });
    expect(decideStage(facts({ planRound: "open", reported: "building" })).stage).toBe("plan-review");
  });

  it("goes back to planning when changes are requested, and to building once approved", () => {
    expect(decideStage(facts({ planRound: "changes_requested", reported: "plan-review" }))).toMatchObject({
      stage: "planning",
      source: "inferred",
    });
    expect(decideStage(facts({ planRound: "approved", reported: "plan-review" })).stage).toBe("building");
    expect(decideStage(facts({ planRound: "approved" })).stage).toBe("building");
  });

  it("puts an open review round above everything but paused", () => {
    const withPrs = facts({ prs: [pr(50, "open")], reviewRound: "needs-review", planRound: "open" });
    expect(decideStage(withPrs).stage).toBe("code-review");
    expect(decideStage({ ...withPrs, reported: "in-milestone" }).stage).toBe("code-review");
    expect(decideStage({ ...withPrs, reported: "paused" }).stage).toBe("paused");
  });

  it("keeps a reported stage until the facts move past it", () => {
    expect(decideStage(facts({ reported: "plan-review" }))).toMatchObject({ stage: "plan-review", source: "reported" });
    expect(decideStage(facts({ reported: "in-review", prs: [pr(1, "draft")] })).stage).toBe("in-review");
    expect(decideStage(facts({ reported: "planning", prs: [pr(1, "open")] }))).toMatchObject({ stage: "in-review", source: "inferred" });
    expect(decideStage(facts({ reported: "done" })).stage).toBe("done");
  });

  it("lets an agent building the next layer stay in Building over its draft PRs", () => {
    const local: PullRequest = { repo: "x", number: null, url: null, label: "route PR", base: null, state: "local" };
    expect(decideStage(facts({ reported: "building", prs: [pr(76, "draft"), pr(77, "draft"), local] }))).toMatchObject({
      stage: "building",
      source: "reported",
    });
    expect(decideStage(facts({ reported: "building", planRound: "approved" })).stage).toBe("building");
  });

  it("moves past a building report once a PR is open or everything is merged", () => {
    expect(decideStage(facts({ reported: "building", prs: [pr(76, "open"), pr(77, "draft")] })).stage).toBe("in-review");
    expect(decideStage(facts({ reported: "building", prs: [pr(76, "merged")] })).stage).toBe("in-milestone");
    expect(decideStage(facts({ reported: "building", reviewRound: "needs-review" })).stage).toBe("code-review");
  });

  it("shows Building while the user's comments are with the agent", () => {
    const withAgent = facts({ reviewRound: "with-agent", prs: [pr(76, "draft")], reported: "code-review" });
    expect(decideStage(withAgent)).toMatchObject({ stage: "building", source: "inferred" });
    expect(decideStage({ ...withAgent, reported: "draft-pr", reportedAfterReview: true }).stage).toBe("draft-pr");
    expect(decideStage({ ...withAgent, reported: "paused" }).stage).toBe("paused");
  });

  it("ends a reported plan review when its round is decided", () => {
    expect(decideStage(facts({ reported: "plan-review", planRound: "approved" })).stage).toBe("building");
  });
});

describe("milestoneFor", () => {
  const options = (milestonePattern: string, milestoneLabel = "$1") =>
    boardOptionsSchema.parse({ milestonePattern, milestoneLabel });

  it.each([
    ["origin/m1-checkout-redesign", "M1"],
    ["m1.5-every-image-resized", "M1.5"],
    ["origin/m12-later", "M12"],
    ["origin/abc-103-api-route", null],
    ["main", null],
    [null, null],
  ])("%s -> %s with an m<N> pattern", (branch, milestone) => {
    expect(milestoneFor(options("^m(\\d+(?:\\.\\d+)?)-", "M$1"), branch)).toBe(milestone);
  });

  it("is off without a pattern, and survives a bad one", () => {
    expect(milestoneFor(options(""), "origin/m1-x")).toBeNull();
    expect(milestoneFor(options("("), "origin/m1-x")).toBeNull();
    expect(milestoneFor(options("^release-(\\d+)"), "release-7-final")).toBe("7");
  });
});
