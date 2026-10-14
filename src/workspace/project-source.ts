import { createTar, downloadBlob, projectRelativePath, type ArchiveEntry } from "./archive";

// Embed the current source snapshot, never node_modules, generated builds or
// environment secrets. The existing single-file Vite build keeps this offline.
const sourceFiles = import.meta.glob<string>(
  [
    "../../src/**/*.{ts,tsx,css,json}",
    "../../scripts/**/*.{ts,mjs,json}",
    "../../package.json",
    "../../package-lock.json",
    "../../tsconfig.json",
    "../../vite.config.ts",
    "../../index.html",
    "../../BACKUP.md",
    "../../PROJECT_HEALTH.md",
    "../../.gitignore",
  ],
  { query: "?raw", import: "default", eager: true }
);

export const embeddedSourceCount = Object.keys(sourceFiles).length;

export async function downloadProjectBackup(checkpointText: string | null, checkpointWarning: string | null = null): Promise<void> {
  const entries: ArchiveEntry[] = Object.entries(sourceFiles).map(([path, data]) => ({
    path: projectRelativePath(path),
    data,
  }));
  const names = new Set(entries.map((entry) => entry.path));
  for (const required of ["src/App.tsx", "src/main.tsx", "package.json", "package-lock.json", "tsconfig.json", "vite.config.ts", "index.html"]) {
    if (!names.has(required)) throw new Error(`Source archive is incomplete: ${required} is missing`);
  }
  if (checkpointText) entries.push({ path: "world-checkpoint.json", data: checkpointText });
  const encoder = new TextEncoder();
  const manifest: { path: string; bytes: number; sha256: string | null }[] = [];
  for (const entry of entries) {
    const data = encoder.encode(String(entry.data));
    let sha256: string | null = null;
    if (globalThis.crypto?.subtle) {
      const digest = await crypto.subtle.digest("SHA-256", data);
      sha256 = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    manifest.push({ path: entry.path, bytes: data.byteLength, sha256 });
  }
  entries.push({
    path: "BACKUP_MANIFEST.json",
    data: JSON.stringify({
      format: "terra-ex-nihilo/source-backup",
      version: 1,
      savedAt: new Date().toISOString(),
      includesWorldCheckpoint: checkpointText !== null,
      checkpointWarning,
      excludes: ["node_modules", "dist", ".git", ".env and secrets"],
      populationRedesign: "Pending: this checkpoint preserves legacy fixed-population settlement data",
      files: manifest,
    }, null, 2),
  });
  const tar = createTar(entries);
  const blob = new Blob([tar], { type: "application/x-tar" });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  if (typeof CompressionStream !== "undefined") {
    const compressed = blob.stream().pipeThrough(new CompressionStream("gzip"));
    downloadBlob(`terra-project-${stamp}.tar.gz`, await new Response(compressed).blob());
  } else {
    downloadBlob(`terra-project-${stamp}.tar`, blob);
  }
}