// Whether a ticket's merged PRs have reached their repo's default branch,
// asked of GitHub through the `gh` CLI on the bb server. Without `gh` or a
// login every answer stays "not yet", so the board falls back to In milestone.
import { execFile } from "node:child_process";
import type { PullRequest } from "./contract";

/** Runs `gh` with these arguments and returns its stdout. */
export type Gh = (args: string[]) => Promise<string>;

export const runGh: Gh = (args) =>
  new Promise((resolve, reject) => {
    execFile("gh", args, { timeout: 20_000, maxBuffer: 1 << 20 }, (error, stdout) =>
      error ? reject(error) : resolve(stdout),
    );
  });

/** A branch that has not reached the default branch is asked about again after this long. */
const RECHECK_MS = 10 * 60_000;

/** `owner/repo` from the PR's URL, else from `repo` when it names the owner. */
export function repoSlug(pr: PullRequest): string | null {
  const fromUrl = pr.url?.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/\d+/)?.[1];
  if (fromUrl) return fromUrl;
  return /^[^/\s]+\/[^/\s]+$/.test(pr.repo) ? pr.repo : null;
}

const path = (branch: string) => branch.split("/").map(encodeURIComponent).join("/");
const time = (iso: string) => (iso ? Date.parse(iso) || null : null);

interface BranchState {
  /** When the latest PR from the branch into the default branch merged. */
  releasedAt: number | null;
  /** The branch was an ancestor of the default branch when checked. */
  ancestor: boolean;
  checkedAt: number;
}

export class Landings {
  /** Base branch, merge time and head commit of each merged PR, by `owner/repo#n`. */
  private readonly prs = new Map<string, { base: string; mergedAt: number; head: string }>();
  private readonly defaults = new Map<string, string>();
  private readonly branches = new Map<string, BranchState>();
  /** PRs known to be in the default branch; that never changes back. */
  private readonly landedPrs = new Set<string>();
  private unavailable = false;

  constructor(
    private readonly gh: Gh,
    private readonly warn: (message: string) => void,
    private readonly now: () => number = Date.now,
  ) {}

  /** From what is known now: true when every merged PR has reached the default branch. */
  landed(prs: PullRequest[]): boolean {
    const merged = prs.filter((pr) => pr.state === "merged");
    return merged.length > 0 && merged.every((pr) => this.prLanded(pr));
  }

  private prLanded(pr: PullRequest): boolean {
    const slug = repoSlug(pr);
    if (!slug || pr.number === null) return false;
    const id = `${slug}#${pr.number}`;
    if (this.landedPrs.has(id)) return true;
    const info = this.prs.get(id);
    const main = this.defaults.get(slug);
    if (!info || main === undefined) return false;
    const branch = this.branches.get(`${slug}:${info.base}`);
    const landed =
      info.base === main ||
      (branch !== undefined &&
        ((branch.releasedAt ?? 0) >= info.mergedAt || (branch.ancestor && branch.checkedAt >= info.mergedAt)));
    if (landed) this.landedPrs.add(id);
    return landed;
  }

  /** Asks GitHub what is missing or stale for these PRs. */
  async refresh(prs: PullRequest[]): Promise<void> {
    for (const pr of prs) {
      if (this.unavailable) return;
      const slug = repoSlug(pr);
      if (pr.state !== "merged" || !slug || pr.number === null || this.prLanded(pr)) continue;
      try {
        const id = `${slug}#${pr.number}`;
        await this.readPr(slug, pr.number);
        if (!this.defaults.has(slug)) {
          this.defaults.set(slug, (await this.gh(["api", `repos/${slug}`, "--jq", ".default_branch"])).trim());
        }
        const { base } = this.prs.get(id)!;
        const key = `${slug}:${base}`;
        const known = this.branches.get(key);
        if (this.prLanded(pr) || (known && this.now() - known.checkedAt < RECHECK_MS)) continue;
        this.branches.set(key, await this.branch(slug, base, this.defaults.get(slug)!));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          this.unavailable = true;
          this.warn("gh is not installed on the bb server; merged milestones stay In milestone.");
        } else {
          this.warn(`gh ${slug}#${pr.number}: ${String(error).slice(0, 300)}`);
        }
      }
    }
  }

  private async readPr(slug: string, number: number): Promise<{ base: string; mergedAt: number; head: string }> {
    const id = `${slug}#${number}`;
    const known = this.prs.get(id);
    if (known) return known;
    const out = await this.gh(["api", `repos/${slug}/pulls/${number}`, "--jq", '[.base.ref, .merged_at // "", .head.sha] | @tsv']);
    const [base = "", mergedAt = "", head = ""] = out.trim().split("\t");
    const info = { base, mergedAt: time(mergedAt) ?? this.now(), head };
    this.prs.set(id, info);
    return info;
  }

  /**
   * Whether GitHub merged this commit as the head of one of these PRs: then a
   * worktree sitting on it has nothing unpushed, even after GitHub deleted the
   * branch.
   */
  async mergedHead(prs: PullRequest[], sha: string): Promise<boolean> {
    for (const pr of prs) {
      const slug = repoSlug(pr);
      if (pr.state !== "merged" || !slug || pr.number === null) continue;
      try {
        if ((await this.readPr(slug, pr.number)).head === sha) return true;
      } catch (error) {
        this.warn(`gh ${slug}#${pr.number}: ${String(error).slice(0, 300)}`);
      }
    }
    return false;
  }

  /** Release PRs from the branch into the default branch (possibly squashed), and ancestry. */
  private async branch(slug: string, branch: string, main: string): Promise<BranchState> {
    const checkedAt = this.now();
    const owner = slug.split("/")[0]!;
    const query = new URLSearchParams({ state: "closed", base: main, head: `${owner}:${branch}`, per_page: "100" });
    const released = await this.gh(["api", `repos/${slug}/pulls?${query}`, "--jq", '[.[].merged_at | select(. != null)] | max // ""']);
    let ancestor = false;
    try {
      const status = (await this.gh(["api", `repos/${slug}/compare/${path(branch)}...${path(main)}`, "--jq", ".status"])).trim();
      ancestor = status === "ahead" || status === "identical";
    } catch {
      // A deleted branch: only its release PR can tell.
    }
    return { releasedAt: time(released.trim()), ancestor, checkedAt };
  }
}
