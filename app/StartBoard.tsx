import { useState } from "react";
import {
  experimental_useRpcMutation as useRpcMutation,
  experimental_useSidebarThreads as useSidebarThreads,
} from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { rpcContract } from "../src/contract";
import { errorText, useGo } from "./hooks";

/** First run, or "New board": pick an orchestrator thread or start one. */
export function StartBoard() {
  const go = useGo();
  const { threads, projects } = useSidebarThreads();
  const create = useRpcMutation({ contract: rpcContract, method: "boards.create" });
  const start = useRpcMutation({ contract: rpcContract, method: "boards.start" });
  const [query, setQuery] = useState("");
  const [projectId, setProjectId] = useState("");
  const [name, setName] = useState("");
  const candidates = threads
    .filter((t) => !t.parentThreadId && !t.isArchived && !t.isHidden)
    .filter((t) => t.displayTitle.toLowerCase().includes(query.trim().toLowerCase()))
    .slice(0, 12);
  const error = create.error ?? start.error;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">Start a board</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          A board follows one orchestrator thread. Every thread it starts with a ticket key in its title (like ABC-123)
          becomes a ticket, and the threads those start become its implementers. Agents send you decisions here.
        </p>
      </div>

      <section className="space-y-2" aria-label="Use an existing thread">
        <h2 className="text-sm font-semibold">Use a thread you already have</h2>
        <Input
          aria-label="Find a thread"
          placeholder="Find a thread"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <ul className="divide-y divide-border rounded-lg border border-border text-sm">
          {candidates.length === 0 && <li className="px-3 py-2 text-muted-foreground">No matching top-level threads.</li>}
          {candidates.map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1 truncate">{t.displayTitle}</span>
              <Button
                size="sm"
                variant="secondary"
                disabled={create.isPending}
                onClick={() =>
                  void create.mutate({ threadId: t.id }).then((board) => go.board(board.id), () => {})
                }
              >
                Use as orchestrator
              </Button>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2" aria-label="Start a new orchestrator">
        <h2 className="text-sm font-semibold">Or start a new orchestrator thread</h2>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!projectId || !name.trim()) return;
            void start.mutate({ projectId, name: name.trim() }).then((board) => go.board(board.id), () => {});
          }}
        >
          <select
            aria-label="Project"
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
            className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
          >
            <option value="">Choose a project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <Input
            aria-label="Board name"
            placeholder="Board name, e.g. Q4 checkout work"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="min-w-56 flex-1"
          />
          <Button type="submit" disabled={!projectId || !name.trim() || start.isPending}>
            Start orchestrator
          </Button>
        </form>
      </section>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {errorText(error)}
        </p>
      )}
    </div>
  );
}
