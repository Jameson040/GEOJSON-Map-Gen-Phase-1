export interface ArchiveEntry {
  path: string;
  data: string | Uint8Array;
}

const encoder = new TextEncoder();

/** Vite normalizes glob keys relative to src/workspace, not the glob literal. */
export function projectRelativePath(key: string): string {
  const parts = key.startsWith("/") ? [] : ["src", "workspace"];
  for (const part of key.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) throw new Error("Source path escapes the project root");
      parts.pop();
    } else parts.push(part);
  }
  return parts.join("/");
}

/** Dependency-free POSIX tar writer. Source and checkpoints remain separate files. */
export function createTar(entries: ArchiveEntry[]): Uint8Array<ArrayBuffer> {
  const parts: Uint8Array[] = [];
  for (const entry of [...entries].sort((a, b) => a.path.localeCompare(b.path))) {
    if (!entry.path || entry.path.startsWith("/") || entry.path.split("/").includes("..")) {
      throw new Error(`Unsafe archive path: ${entry.path}`);
    }
    const name = encoder.encode(entry.path);
    if (name.length > 100) throw new Error(`Archive path exceeds 100 bytes: ${entry.path}`);
    const data = typeof entry.data === "string" ? encoder.encode(entry.data) : entry.data;
    const header = new Uint8Array(512);
    const field = (offset: number, length: number, text: string) => {
      header.set(encoder.encode(text).slice(0, length), offset);
    };
    field(0, 100, entry.path);
    field(100, 8, "0000644\0");
    field(108, 8, "0000000\0");
    field(116, 8, "0000000\0");
    field(124, 12, `${data.length.toString(8).padStart(11, "0")}\0`);
    field(136, 12, "00000000000\0");
    field(148, 8, "        ");
    field(156, 1, "0");
    field(257, 6, "ustar\0");
    field(263, 2, "00");
    const checksum = header.reduce((sum, b) => sum + b, 0);
    field(148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
    parts.push(header, data);
    const padding = (512 - (data.length % 512)) % 512;
    if (padding) parts.push(new Uint8Array(padding));
  }
  parts.push(new Uint8Array(1024));
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

export function downloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking immediately can cancel downloads in some browsers.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function downloadCheckpoint(name: string, text: string): void {
  downloadBlob(name, new Blob([text], { type: "application/json;charset=utf-8" }));
}