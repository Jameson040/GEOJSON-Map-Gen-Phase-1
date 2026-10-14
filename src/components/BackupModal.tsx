import { useRef, useState } from "react";
import { Archive, Download, FileJson, Loader2, Upload, X } from "lucide-react";
import type { WorkspaceCheckpoint } from "../workspace/checkpoint";
import { MAX_CHECKPOINT_BYTES, readCheckpoint } from "../workspace/checkpoint";
import { downloadCheckpoint } from "../workspace/archive";
import { downloadProjectBackup, embeddedSourceCount } from "../workspace/project-source";

interface Props {
  open: boolean;
  busy: boolean;
  regionCount: number;
  onClose: () => void;
  makeCheckpoint: () => WorkspaceCheckpoint | null;
  onRestore: (checkpoint: WorkspaceCheckpoint) => void;
}

export function BackupModal({ open, busy, regionCount, onClose, makeCheckpoint, onRestore }: Props) {
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  if (!open) return null;

  const save = async (source: boolean) => {
    setWorking(true);
    setError(null);
    setMessage(null);
    try {
      // Allow React to paint the busy indicator before serializing a large world.
      await new Promise((resolve) => setTimeout(resolve, 0));
      let checkpoint: WorkspaceCheckpoint | null = null;
      let checkpointWarning: string | null = null;
      try {
        checkpoint = makeCheckpoint();
      } catch (e) {
        if (!source) throw e;
        checkpointWarning = e instanceof Error ? e.message : String(e);
      }
      const text = checkpoint ? JSON.stringify(checkpoint) : null;
      if (source) {
        await downloadProjectBackup(text, checkpointWarning);
        setMessage(checkpointWarning
          ? `Source archive download started. World data was not included because validation failed: ${checkpointWarning}`
          : "Project archive download started. It also includes your generated world, when available.");
      } else {
        if (!text) throw new Error("Wait until the planet is ready before saving a world checkpoint");
        const seed = checkpoint!.macro.config.seed.replace(/[^a-zA-Z0-9_-]/g, "-");
        downloadCheckpoint(`terra-world-${seed}-${Date.now()}.json`, text);
        setMessage("Checkpoint download started. Keep this JSON file to restore the generated world later.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking(false);
    }
  };

  const restore = async (file: File) => {
    setWorking(true);
    setMessage(null);
    setError(null);
    try {
      if (file.size > MAX_CHECKPOINT_BYTES) throw new Error("Restore files must be smaller than 150 MB");
      const checkpoint = readCheckpoint(await file.text());
      const confirmed = window.confirm("Replace the current workspace with this saved checkpoint? Save your current work first if you need it.");
      if (!confirmed) return;
      onRestore(checkpoint);
      setMessage("Checkpoint restored without regenerating any layer.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <section role="dialog" aria-modal="true" aria-labelledby="backup-title" className="w-full max-w-xl overflow-hidden rounded-2xl border border-white/15 bg-slate-900 shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-white/10 bg-slate-950/60 p-5">
          <div className="flex items-center gap-3">
            <Archive className="h-6 w-6 text-teal-300" />
            <div>
              <h2 id="backup-title" className="text-lg font-semibold text-white">Save a Safety Checkpoint</h2>
              <p className="text-xs text-zinc-400">Project source and generated work are two different backups.</p>
            </div>
          </div>
          <button aria-label="Close backup dialog" disabled={working} onClick={onClose} className="rounded-md p-1 text-zinc-400 hover:bg-white/10 hover:text-white"><X className="h-5 w-5" /></button>
        </header>
        <div className="space-y-5 p-5 text-sm">
          <p className="leading-relaxed text-zinc-300">
            Your current workspace has <strong className="text-white">{regionCount} generated regions</strong>.
            Save the source archive before making architectural changes, and save the JSON checkpoint to preserve actual generated layers and seeds.
          </p>
          <div className="space-y-2">
            <button disabled={busy || working} onClick={() => void save(true)} className="flex w-full items-center justify-between rounded-lg border border-teal-500/30 bg-teal-500/10 px-4 py-3 text-left text-teal-200 transition hover:bg-teal-500/20 disabled:opacity-40">
              <span className="flex items-center gap-2"><Archive className="h-4 w-4" /> Download Project Source</span>
              <span className="font-mono text-[10px] text-zinc-400">{embeddedSourceCount} files / tar.gz</span>
            </button>
            <button disabled={busy || working} onClick={() => void save(false)} className="flex w-full items-center justify-between rounded-lg border border-white/15 px-4 py-3 text-left text-zinc-200 transition hover:bg-white/5 disabled:opacity-40">
              <span className="flex items-center gap-2"><FileJson className="h-4 w-4 text-amber-300" /> Save Generated World</span>
              <Download className="h-4 w-4 text-zinc-500" />
            </button>
          </div>
          <div className="border-t border-white/10 pt-4">
            <button disabled={busy || working} onClick={() => fileInput.current?.click()} className="flex items-center gap-2 text-xs font-semibold text-zinc-300 hover:text-white disabled:opacity-40"><Upload className="h-4 w-4" /> Restore a World Checkpoint</button>
            <input ref={fileInput} type="file" accept=".json,application/json" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) void restore(file); }} />
            <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">Restores saved data, not a newly generated approximation. Invalid files are rejected before anything is replaced.</p>
          </div>
          <p className="border-l-2 border-amber-500/40 pl-3 text-[11px] leading-relaxed text-amber-200/80">Population architecture is still legacy in this checkpoint. Habitat-only sites and time-dependent, per-settlement population remain pending; this backup does not claim they are implemented.</p>
          {busy && <p className="text-xs text-amber-300">Wait for the generation job to finish before backing up or restoring.</p>}
          {working && <p role="status" className="flex items-center gap-2 text-xs text-teal-300"><Loader2 className="h-4 w-4 animate-spin" /> Preparing checkpoint...</p>}
          {message && <p role="status" className="text-xs text-emerald-300">{message}</p>}
          {error && <p role="alert" className="break-words text-xs text-rose-300">{error}</p>}
        </div>
      </section>
    </div>
  );
}