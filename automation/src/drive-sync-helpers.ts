import path from 'node:path';
import { downloadFile } from './drive.js';
import type { DriveEntry } from './drive.js';

/**
 * Shared by sync-drive.ts (its own new-entries sweep) and scheduled-posts.ts
 * (a targeted single-file lookup by name). Pulled out of sync-drive.ts,
 * which has its own self-invoking main() -- importing from a file like that
 * directly risks accidentally running it (bit us once already this session
 * during unit testing).
 */

/** Under GitHub's hard 100MB-per-file push limit, with margin. */
export const MAX_FILE_BYTES = 90 * 1024 * 1024;

export function exceedsSizeGuard(entry: DriveEntry): boolean {
  return !!entry.size && Number(entry.size) > MAX_FILE_BYTES;
}

export function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
}

export function postFolderName(entry: DriveEntry): string {
  const prefix = new Date(entry.createdTime ?? Date.now()).toISOString().replace(/[:.]/g, '-');
  return `${prefix}-${sanitize(entry.name)}`;
}

/** Returns whether it actually wrote a file -- false (skipped by the size guard) means destDir may not even exist yet. */
export async function downloadEntry(entry: DriveEntry, destDir: string, label: string): Promise<boolean> {
  if (exceedsSizeGuard(entry)) {
    const mb = Math.round(Number(entry.size) / 1024 / 1024);
    console.log(`${label} skipping "${entry.name}" -- ${mb}MB exceeds the ${MAX_FILE_BYTES / 1024 / 1024}MB guard`);
    return false;
  }
  const destPath = path.join(destDir, sanitize(entry.name));
  console.log(`${label} downloading "${entry.name}" -> ${destPath}`);
  await downloadFile(entry.id, destPath);
  return true;
}
