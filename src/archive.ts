// When a Done ticket's threads may be archived. Archiving retires their
// worktrees, which bb may then remove from disk, so every check errs on the
// side of keeping them.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { Ticket } from "./contract";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Why the ticket itself is not ready: a PR still open, or something waiting. */
export function ticketBlocker(ticket: Ticket, facts: { reviewOpen: boolean; running: boolean }): string | null {
  for (const pr of ticket.prs) {
    if (pr.state === "local") return "local work not pushed";
    if (pr.state === "open" || pr.state === "draft" || pr.state === "held") {
      const name = pr.number !== null ? `PR #${pr.number}` : "a PR";
      return `${name} ${pr.state === "open" ? "open" : pr.state}`;
    }
  }
  if (ticket.openDecisions > 0) return plural(ticket.openDecisions, "open decision");
  if (ticket.planRound?.status === "open") return "plan round open";
  if (facts.reviewOpen) return "review round open";
  if (facts.running) return "an agent is running";
  return null;
}

interface Status {
  outcome: string;
  workspace?: {
    branch: { defaultBranch: string };
    checkout: { kind: string; branchName?: string | null };
    workingTree: { hasUncommittedChanges: boolean };
    mergeBase: {
      baseRef: string | null;
      aheadCount: number;
      hasCommittedUnmergedChanges: boolean;
      squashMergeCheckComplete: boolean;
    } | null;
  };
}

/**
 * Why a worktree is not safe to retire: uncommitted changes, commits its
 * remote branch lacks, or no way to tell. A missing remote branch reads as
 * "0 ahead" with no base ref, so it only passes when the work is already in
 * the default branch.
 */
export async function workspaceBlocker(bb: BbPluginApi, environmentId: string): Promise<string | null> {
  const status = (mergeBaseBranch?: string) =>
    bb.sdk.environments.status({ environmentId, ...(mergeBaseBranch ? { mergeBaseBranch } : {}) }) as Promise<Status>;
  try {
    const now = await status();
    if (now.outcome !== "available" || !now.workspace) return "workspace unavailable";
    const { checkout, workingTree, branch } = now.workspace;
    const name = checkout.kind === "branch" ? (checkout.branchName ?? null) : null;
    if (workingTree.hasUncommittedChanges) return `uncommitted changes in ${name ?? "the worktree"}`;
    if (name) {
      const upstream = (await status(`origin/${name}`)).workspace?.mergeBase;
      if (upstream?.baseRef) return upstream.aheadCount > 0 ? plural(upstream.aheadCount, "unpushed commit") : null;
    }
    const main = (await status(`origin/${branch.defaultBranch}`)).workspace?.mergeBase;
    if (main?.baseRef && main.squashMergeCheckComplete && !main.hasCommittedUnmergedChanges) return null;
    return "branch not on the remote";
  } catch (error) {
    bb.log.warn(`environment ${environmentId} status: ${String(error).slice(0, 300)}`);
    return "workspace unavailable";
  }
}
