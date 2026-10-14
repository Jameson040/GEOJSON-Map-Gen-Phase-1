import type { WorkspaceTab } from "../world/types";
import { Globe2, X, Map as MapIcon, Loader2 } from "lucide-react";

export function TabBar({
  tabs,
  activeId,
  onSelect,
  onClose,
  busyTabId,
}: {
  tabs: WorkspaceTab[];
  activeId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  busyTabId: string | null;
}) {
  return (
    <div className="flex h-9 shrink-0 items-stretch gap-1 overflow-x-auto border-b border-white/10 bg-slate-950 px-2">
      {tabs.map((t) => {
        const active = t.id === activeId;
        const busy = busyTabId === t.id;
        return (
          <div
            key={t.id}
            className={`group relative flex items-center gap-1.5 whitespace-nowrap rounded-t-lg border-x border-t px-3 text-xs transition ${
              active
                ? "border-white/15 bg-slate-900 text-white"
                : "border-transparent text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
            }`}
          >
            <button onClick={() => onSelect(t.id)} className="flex items-center gap-1.5 py-1.5">
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-teal-400" />
              ) : t.kind === "planet" ? (
                <Globe2 className={`h-3.5 w-3.5 ${active ? "text-teal-400" : ""}`} />
              ) : (
                <MapIcon className={`h-3.5 w-3.5 ${active ? "text-amber-400" : ""}`} />
              )}
              <span className="max-w-[10rem] truncate font-medium">{t.title}</span>
            </button>
            {t.kind === "region" && (
              <button
                onClick={() => onClose(t.id)}
                title="Close tab (keeps data cached)"
                className="rounded p-0.5 text-zinc-500 opacity-0 transition hover:bg-white/10 hover:text-white group-hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            )}
            {active && <span className="absolute inset-x-0 -bottom-px h-px bg-slate-900" />}
          </div>
        );
      })}
    </div>
  );
}
