import type { ReactNode } from "react";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";
import {
  STAGE_LABELS,
  parseRoute,
  routeBoardId,
  useBoard,
  useBoards,
  useGo,
  useOpenDecisions,
  usePlansWaiting,
} from "./hooks";

/** Replaces the thread list while Conductor is open: boards, the inbox, then this board's tickets. */
export function BoardSidebar({ subPath }: PluginNavPanelProps) {
  const go = useGo();
  const route = parseRoute(subPath);
  const boards = useBoards().data?.boards ?? [];
  const boardId = routeBoardId(route, boards);
  const board = useBoard(boardId);
  const open = useOpenDecisions().data?.decisions ?? [];
  const plans = usePlansWaiting().data?.rounds ?? [];
  const tickets = board.data?.tickets ?? [];
  const currentKey = route.kind === "ticket" ? route.key : null;
  const boardName = (id: number) => boards.find((b) => b.id === id)?.name ?? `Board ${id}`;

  return (
    <nav aria-label="Conductor" className="h-full space-y-4 overflow-y-auto px-2 py-3 text-sm">
      <Group title="Boards">
        {boards.map((b) => (
          <Row key={b.id} active={b.id === boardId && route.kind !== "start"} onClick={() => go.board(b.id)}>
            <span className="flex items-center gap-2">
              <span className="truncate">{b.name}</span>
              {b.openDecisions > 0 && <span className="ml-auto text-xs font-medium">{b.openDecisions}</span>}
            </span>
          </Row>
        ))}
        <Row active={route.kind === "start"} onClick={() => go.start()}>
          <span className="text-muted-foreground">New board</span>
        </Row>
      </Group>
      <Group title={`Inbox (${open.length + plans.length})`}>
        {open.length + plans.length === 0 && <p className="px-2 text-xs text-muted-foreground">Nothing waiting.</p>}
        {plans.map((r) => (
          <Row
            key={`plan-${r.id}`}
            active={route.kind === "plan" && route.key === r.ticketKey}
            onClick={() => go.plan(r.boardId, r.ticketKey, r.n)}
          >
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="size-1.5 rounded-full bg-amber-500" />
              Plan · {r.ticketKey}
              {boards.length > 1 && ` · ${boardName(r.boardId)}`}
            </span>
            <span>Review plan round {r.n}</span>
          </Row>
        ))}
        {open.map((d) => (
          <Row key={d.id} active={false} onClick={() => go.ticket(d.boardId, d.ticketKey)}>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className={cn("size-1.5 rounded-full", d.blocking ? "bg-amber-500" : "bg-muted-foreground")} />
              {d.ref} · {d.ticketKey}
              {boards.length > 1 && ` · ${boardName(d.boardId)}`}
              {d.blocking && " · blocking"}
            </span>
            <span className="line-clamp-2">{d.question}</span>
          </Row>
        ))}
      </Group>
      {boardId !== null && (
        <Group title="Tickets">
          <Row active={route.kind === "board" || route.kind === "home"} onClick={() => go.board(boardId)}>
            All tickets
          </Row>
          {tickets.map((t) => (
            <Row key={t.key} active={currentKey === t.key} onClick={() => go.ticket(boardId, t.key)}>
              <span className="flex items-center gap-2">
                <span className="text-xs font-semibold">{t.key}</span>
                <span className="truncate text-xs text-muted-foreground">{STAGE_LABELS[t.stage]}</span>
                {t.openDecisions > 0 && <span className="ml-auto text-xs font-medium">{t.openDecisions}</span>}
              </span>
            </Row>
          ))}
        </Group>
      )}
    </nav>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <h3 className="px-2 text-xs font-semibold text-muted-foreground">{title}</h3>
      {children}
    </div>
  );
}

function Row({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={cn("flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-muted/60", active && "bg-muted")}
    >
      {children}
    </button>
  );
}
