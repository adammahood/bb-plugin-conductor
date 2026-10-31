// Conductor frontend: the board pages and inbox, plus ticket context on
// every ticket agent's thread. Components live in app/.
import {
  definePluginApp,
  experimental_THREAD_INFO_ROW_GROUPS as INFO_ROW_GROUPS,
} from "@get-bb/plugin-sdk/app";
import { AGENT_TAB, AgentTab, ORCHESTRATOR_TAB, OrchestratorTab } from "./app/AgentTabs";
import { BoardHeader, BoardPage } from "./app/BoardPage";
import { BoardSidebar } from "./app/BoardSidebar";
import { PANEL_PATH, useDecisionBadge } from "./app/hooks";
import { mountRowStatus, RowStatusOverlay } from "./app/rowStatus";
import { boardActionItem, useBoardActionData } from "./app/threadAction";
import {
  TicketHeaderChip,
  TicketInfoRows,
  TicketSegmentDetails,
  TicketSegmentSummary,
  useIsTicketThread,
} from "./app/ThreadTicket";

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "board",
    title: "Conductor",
    icon: "conductor/conductor",
    path: PANEL_PATH,
    component: BoardPage,
    headerContent: BoardHeader,
    experimental_sidebar: BoardSidebar,
    experimental_useBadge: useDecisionBadge,
  });

  app.slots.experimental_tab({
    ...ORCHESTRATOR_TAB,
    title: "Orchestrator",
    icon: "MessageSquare",
    tooltip: "The board's orchestrator thread",
    layout: "flush",
    component: OrchestratorTab,
  });

  app.slots.experimental_tab({
    ...AGENT_TAB,
    title: "Agent thread",
    icon: "MessageSquare",
    layout: "flush",
    component: AgentTab,
  });

  app.slots.experimental_threadInfoRow({
    id: "ticket",
    group: INFO_ROW_GROUPS.thread,
    order: 5,
    component: TicketInfoRows,
  });

  app.slots.experimental_threadContextSegment({
    id: "ticket",
    title: "Conductor ticket",
    group: "0_phaseBoard",
    summary: TicketSegmentSummary,
    details: TicketSegmentDetails,
    useVisible: useIsTicketThread,
  });

  app.slots.experimental_threadHeaderAction({
    id: "ticket",
    title: "Conductor ticket",
    component: TicketHeaderChip,
  });

  app.slots.experimental_threadAction({
    id: "board",
    title: "Conductor board",
    icon: "Layers",
    group: "conductor",
    useData: useBoardActionData,
    item: boardActionItem,
  });

  app.contentScripts.register({ id: "row-status", mount: mountRowStatus });
  app.slots.experimental_appOverlay({ id: "row-status", component: RowStatusOverlay });
});
