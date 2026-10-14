// Run: node scripts/create-backup.mjs [output-directory]
// Copies original source bytes and records SHA-256 checksums; it never edits
// the project or regenerates any world. Add an exported world JSON separately.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const destination = path.resolve(process.argv[2] ?? path.join(root, "backups", `terra-${stamp}`));
if (destination === path.resolve(root) || path.resolve(root).startsWith(`${destination}${path.sep}`)) {
  throw new Error("Backup destination must not replace the project or an ancestor directory");
}
for (const name of ["src", "scripts", "public", "node_modules", "dist", ".git"]) {
  const protectedDirectory = path.join(root, name);
  if (destination === protectedDirectory || destination.startsWith(`${protectedDirectory}${path.sep}`)) {
    throw new Error("Keep backup output outside source, dependency and build directories");
  }
}
if (existsSync(destination)) throw new Error("Use a new, empty destination so an earlier backup cannot be overwritten");
const roots = ["src", "scripts", "public", "package.json", "package-lock.json", "tsconfig.json", "vite.config.ts", "index.html", "BACKUP.md", "PROJECT_HEALTH.md", ".gitignore"];
const files = [];
function collect(full) {
  if (!existsSync(full)) return;
  for (const entry of readdirSync(full, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const item = path.join(full, entry.name);
    if (entry.isDirectory()) collect(item);
    else files.push(item);
  }
}
for (const name of roots) {
  const full = path.join(root, name);
  if (!existsSync(full)) continue;
  if (["src", "scripts", "public"].includes(name)) collect(full);
  else files.push(full);
}
mkdirSync(destination, { recursive: true });
const manifest = [];
for (const full of files.sort()) {
  const relative = path.relative(root, full);
  const output = path.join(destination, relative);
  mkdirSync(path.dirname(output), { recursive: true });
  copyFileSync(full, output);
  const bytes = readFileSync(full);
  manifest.push({ path: relative.split(path.sep).join("/"), bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
}
writeFileSync(path.join(destination, "BACKUP_MANIFEST.json"), JSON.stringify({
  format: "terra-ex-nihilo/source-backup",
  savedAt: new Date().toISOString(),
  files: manifest,
  note: "Source backup only. Export and retain your generated-world checkpoint from the application as well.",
}, null, 2));
console.log(`Backed up ${manifest.length} files to ${destination}`);