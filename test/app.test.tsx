// @vitest-environment jsdom
import { fireEvent, waitFor, within } from "@testing-library/react";
import {
  loadPluginApp,
  mountPluginContentScripts,
  renderSlot,
  type PluginRpcTestHandlers,
} from "@get-bb/plugin-sdk/testing/app";
import type { PluginRpcContract } from "@get-bb/plugin-sdk/app";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Board, BoardSummary, Decision, rpcContract, Ticket } from "../src/contract";
import { boardOptionsSchema } from "../src/options";
import { useDecisionBadge } from "../app/hooks";

const ticket: Ticket = {
  boardId: 1,
  key: "ABC-101",
  title: "Accept avatar uploads on sign-up",
  repo: "accounts-api",
  projectId: "proj_api",
  linearUrl: "https://linear.app/acme/issue/ABC-101",
  linearState: "In Progress",
  leadThreadId: "thr_lead1",
  implementerThreadIds: ["thr_impl1"],
  environmentId: "env_1",
  branch: "bb/abc-101",
  base: "origin/abc-103-api-route",
  milestone: "M4",
  stage: "plan-review",
  stageSource: "inferred",
  reportedStage: null,
  reportedAt: null,
  stageNote: null,
  sharedWith: ["ABC-103"],
  prs: [],
  plan: { file: "2026-10-28-abc101-avatar-uploads.md", writtenAt: 1 },
  openReview: null,
  openDecisions: 1,
  blockingDecisions: 1,
  updatedAt: 1,
};

const decision: Decision = {
  id: 7,
  ref: "D-7",
  boardId: 1,
  ticketKey: "ABC-101",
  threadId: "thr_impl1",
  question: "Name the avatar key AvatarURL or AvatarUrl?",
  options: [
    { label: "AvatarURL", detail: "Matches PhotoURL" },
    { label: "AvatarUrl", detail: null },
  ],
  recommendation: "AvatarURL",
  reasoning: "The create request already uses PhotoURL.",
  blocking: true,
  status: "open",
  answer: null,
  deliveredAt: null,
  deliveryError: null,
  createdAt: 1,
};

const drafted: Ticket = {
  ...ticket,
  key: "ABC-104",
  title: "Media Jobs - One upload path for every image",
  stage: "in-review",
  plan: null,
  sharedWith: [],
  openDecisions: 0,
  blockingDecisions: 0,
  milestone: "M1.5",
  prs: [
    { repo: "media-jobs", number: 49, url: "https://github.com/acme/media-jobs/pull/49", label: null, base: null, state: "merged" },
    { repo: "media-jobs", number: 50, url: "https://github.com/acme/media-jobs/pull/50", label: null, base: null, state: "open" },
    { repo: "media-jobs", number: 51, url: "https://github.com/acme/media-jobs/pull/51", label: null, base: null, state: "draft" },
  ],
};

const summary: BoardSummary = {
  id: 1,
  name: "Checkout",
  orchestratorThreadId: "thr_orch",
  options: boardOptionsSchema.parse({ milestonePattern: "^m(\\d+)-", rules: { onePrAtATime: true } }),
  openDecisions: 1,
  tickets: 2,
};

const board: Board = {
  board: summary,
  integrations: { linear: true, codeReview: true },
  tickets: [ticket, drafted],
  reviewsWaiting: [],
  nextPr: { ticketKey: "ABC-104", repo: "media-jobs", number: 51, url: null, after: { number: 50, url: null } },
  lastSweepAt: 1,
  sweepError: null,
};

// Typed against the real contract, widened for renderSlot's untyped default.
const handlers = (h: Partial<PluginRpcTestHandlers<typeof rpcContract>>) => h as PluginRpcTestHandlers<PluginRpcContract>;

const rpc = (decisions: Decision[] = [decision], boards: BoardSummary[] = [summary], current: Board = board) =>
  handlers({
  "boards.list": () => ({ boards, integrations: current.integrations }),
  "board.list": () => current,
  "orchestrators.list": () => ({ boards: Object.fromEntries(boards.map((b) => [b.orchestratorThreadId, b.id])) }),
  "boards.create": ({ threadId }) => ({ ...summary, id: 2, orchestratorThreadId: threadId }),
  "boards.update": ({ boardId, name }) => ({ ...summary, id: boardId, name: name ?? summary.name }),
  "decisions.list": () => ({ decisions }),
  "decisions.answer": ({ id, choice, note }) => ({
    ...decision,
    id,
    status: "answered" as const,
    answer: { choice, note: note ?? null, at: 2 },
    deliveredAt: 2,
  }),
  "thread.ticket": ({ threadId }) =>
    threadId === "thr_impl1"
      ? { ticket, role: "implementer" as const, decisions: [decision] }
      : { ticket: null, role: null, decisions: [] },
  });

// Radix controls measure themselves; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const app = await loadPluginApp(() => import("../app"));
let cleanup: (() => unknown) | null = null;
afterEach(async () => {
  await cleanup?.();
  cleanup = null;
});

describe("agent threads in the side panel", () => {
  // Runs first: the orchestrator tab opens once per app session.
  it("opens the orchestrator tab on the first visit and an agent's tab from its card", async () => {
    const opened: unknown[] = [];
    const slot = renderSlot(app.navPanels[0]!, { subPath: "" }, {
      rpc: rpc(),
      experimental_openTab: (call) => {
        opened.push(call);
        return true;
      },
    });
    cleanup = () => slot.lifecycle.unmount();
    await slot.findByText("Accept avatar uploads on sign-up");
    await waitFor(() =>
      expect(opened[0]).toMatchObject({ tab: { id: "orchestrator", availability: "fixed", context: { kind: "nav-panel", panelId: "board" } } }),
    );

    const card = slot.getByRole("region", { name: "Plan review" });
    fireEvent.click(within(card).getByRole("button", { name: "Lead" }));
    expect(opened.at(-1)).toMatchObject({
      tab: { id: "agent", availability: "action" },
      params: { threadId: "thr_lead1" },
      title: "ABC-101 lead",
    });
    expect(opened.filter((call) => (call as { tab: { id: string } }).tab.id === "orchestrator")).toHaveLength(1);
  });

  it("falls back to the thread page where there is no board panel", async () => {
    const slot = renderSlot(app.navPanels[0]!, { subPath: "" }, { rpc: rpc(), experimental_openTab: () => false });
    cleanup = () => slot.lifecycle.unmount();
    await slot.findByText("Accept avatar uploads on sign-up");
    fireEvent.click(within(slot.getByRole("region", { name: "Plan review" })).getByRole("button", { name: "Lead" }));
    expect(slot.inspection.navigateCalls.at(-1)).toMatchObject({ threadId: "thr_lead1" });
  });

  it("registers the orchestrator as a fixed tab and agents as action tabs on the board", () => {
    expect(app.tabs.map((t) => [t.id, t.availability, t.context])).toEqual([
      ["orchestrator", "fixed", { kind: "nav-panel", panelId: "board" }],
      ["agent", "action", { kind: "nav-panel", panelId: "board" }],
    ]);
  });
});

describe("board page", () => {
  it("shows the inbox and the tickets, and answers a decision", async () => {
    const slot = renderSlot(app.navPanels[0]!, { subPath: "" }, { rpc: rpc() });
    cleanup = () => slot.lifecycle.unmount();

    await slot.findByText(decision.question);
    expect(await slot.findByText("Accept avatar uploads on sign-up")).toBeTruthy();
    const planReview = slot.getByRole("region", { name: "Plan review" });
    expect(planReview.textContent).toContain("ABC-101");
    expect(planReview.textContent).toContain("Same agents as ABC-103.");
    const inReview = slot.getByRole("region", { name: "In review" });
    expect(inReview.textContent).toContain("ABC-104");
    expect(inReview.textContent).toContain("1 of 3 merged.");
    expect(slot.getByRole("region", { name: "Draft PRs" }).textContent).toContain("nothing here");
    expect(slot.container.textContent).toContain("#50 is in review now");
    expect((slot.getByLabelText(/AvatarURL/, { selector: "input" }) as HTMLInputElement).checked).toBe(true);

    fireEvent.change(slot.getByLabelText("Note for the agent"), { target: { value: "Keep the acronym" } });
    fireEvent.click(slot.getByRole("button", { name: "Answer" }));

    await waitFor(() =>
      expect(slot.inspection.rpcCalls).toContainEqual({
        method: "decisions.answer",
        input: { id: 7, choice: "AvatarURL", note: "Keep the acronym" },
      }),
    );
  });

  it("sends a custom answer typed under Other", async () => {
    const slot = renderSlot(app.navPanels[0]!, { subPath: "" }, { rpc: rpc() });
    cleanup = () => slot.lifecycle.unmount();
    await slot.findByText(decision.question);

    fireEvent.change(slot.getByLabelText("Your own answer"), { target: { value: "Watermark.URL" } });
    fireEvent.click(slot.getByRole("button", { name: "Answer" }));

    await waitFor(() =>
      expect(slot.inspection.rpcCalls).toContainEqual({
        method: "decisions.answer",
        input: { id: 7, choice: "Watermark.URL" },
      }),
    );
  });
});

describe("badge", () => {
  function BadgeProbe() {
    return <output>{JSON.stringify(useDecisionBadge())}</output>;
  }

  it("counts open decisions and warns when one blocks", async () => {
    const slot = renderSlot({ component: BadgeProbe }, {}, { rpc: rpc() });
    cleanup = () => slot.lifecycle.unmount();
    await waitFor(() =>
      expect(JSON.parse(slot.container.querySelector("output")!.textContent!)).toEqual({
        count: 1,
        tone: "warning",
        label: "1 decision waiting, 1 blocking",
      }),
    );
  });

  it("shows nothing when the inbox is empty", async () => {
    const slot = renderSlot({ component: BadgeProbe }, {}, { rpc: rpc([]) });
    cleanup = () => slot.lifecycle.unmount();
    await waitFor(() => expect(slot.inspection.rpcCalls.length).toBeGreaterThan(0));
    expect(slot.container.querySelector("output")!.textContent).toBe("null");
  });
});

describe("thread context", () => {
  const environment = { id: "env_1" } as never;

  it("shows the ticket in a ticket thread's Info tab", async () => {
    const slot = renderSlot(app.threadInfoRows[0]!, { threadId: "thr_impl1", projectId: "proj_api", environment }, { rpc: rpc() });
    cleanup = () => slot.lifecycle.unmount();
    expect(await slot.findByText("ABC-101 Accept avatar uploads on sign-up")).toBeTruthy();
    expect(slot.getByText("1 waiting on you")).toBeTruthy();
  });

  it("shows nothing for other threads", async () => {
    const slot = renderSlot(app.threadInfoRows[0]!, { threadId: "thr_other", projectId: "proj_api", environment }, { rpc: rpc() });
    cleanup = () => slot.lifecycle.unmount();
    await waitFor(() => expect(slot.inspection.rpcCalls.length).toBeGreaterThan(0));
    expect(slot.container.textContent).toBe("");
  });

  it("marks the asking thread's row while a decision is open", async () => {
    const scripts = await mountPluginContentScripts(app, { pluginId: "conductor" });
    const slot = renderSlot(app.appOverlays[0]!, {}, { rpc: rpc() });
    cleanup = async () => {
      slot.lifecycle.unmount();
      await scripts.lifecycle.dispose();
    };
    await waitFor(() =>
      expect(scripts.inspection.getThreadRowStatus("thr_impl1")).toEqual({
        icon: "CircleQuestion",
        label: "Blocked on a decision from you",
        tone: "error",
      }),
    );
  });
});

describe("boards", () => {
  it("offers to start a board when there is none", async () => {
    const slot = renderSlot(app.navPanels[0]!, { subPath: "" }, { rpc: rpc([], []) });
    cleanup = () => slot.lifecycle.unmount();
    expect(await slot.findByText("Start a board")).toBeTruthy();
    expect(slot.getByText(/Use a thread you already have/)).toBeTruthy();
  });

  it("labels the merged stage by the board's milestone setting", async () => {
    const plain = {
      ...board,
      board: { ...summary, options: boardOptionsSchema.parse({}) },
      tickets: board.tickets.map((t) => ({ ...t, milestone: null })),
      nextPr: null,
    };
    const slot = renderSlot(app.navPanels[0]!, { subPath: "1" }, { rpc: rpc([decision], [plain.board], plain) });
    cleanup = () => slot.lifecycle.unmount();
    await slot.findByText("Accept avatar uploads on sign-up");
    expect(slot.getByRole("region", { name: "Merged" })).toBeTruthy();
    expect(slot.queryByText("Next PR to open")).toBeNull();
  });

  it("saves rule switches from the settings page", async () => {
    const slot = renderSlot(app.navPanels[0]!, { subPath: "1/settings" }, { rpc: rpc() });
    cleanup = () => slot.lifecycle.unmount();
    fireEvent.click(await slot.findByRole("checkbox", { name: "Split PRs by layer" }));
    fireEvent.click(slot.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(slot.inspection.rpcCalls).toContainEqual(
        expect.objectContaining({
          method: "boards.update",
          input: expect.objectContaining({ boardId: 1, options: expect.objectContaining({ rules: expect.objectContaining({ splitPrs: true }) }) }),
        }),
      ),
    );
  });

  it("offers a board from a top-level thread's menu, and opens it from its orchestrator", () => {
    const action = app.threadActions.find((a) => a.id === "board")!;
    const navigate = { toPluginPanel: vi.fn() };
    const data = { boards: { thr_orch: 1 }, create: vi.fn(async () => ({ id: 2 })) };
    const item = (thread: { id: string; parentThreadId: string | null }) =>
      action.item({ thread, data, navigate, sdk: {} } as never);
    expect(item({ id: "thr_orch", parentThreadId: null })).toMatchObject({ label: "Open its Conductor board" });
    expect(item({ id: "thr_new", parentThreadId: null })).toMatchObject({ label: "Use as a Conductor board" });
    expect(item({ id: "thr_child", parentThreadId: "thr_orch" })).toBeNull();
  });
});
