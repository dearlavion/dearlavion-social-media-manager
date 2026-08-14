import path from 'node:path';
import { loadProjects, loadChannels, saveChannels, inboxRoot } from './config.js';
import { listNewEntries, listFolderChildren, downloadFile, isFolder } from './drive.js';
import type { DriveEntry } from './drive.js';

/** Under GitHub's hard 100MB-per-file push limit, with margin. */
export const MAX_FILE_BYTES = 90 * 1024 * 1024;

export function exceedsSizeGuard(entry: DriveEntry): boolean {
  return !!entry.size && Number(entry.size) > MAX_FILE_BYTES;
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
}

function postFolderName(entry: DriveEntry): string {
  const prefix = new Date(entry.createdTime ?? Date.now()).toISOString().replace(/[:.]/g, '-');
  return `${prefix}-${sanitize(entry.name)}`;
}

async function downloadEntry(entry: DriveEntry, destDir: string, label: string): Promise<void> {
  if (exceedsSizeGuard(entry)) {
    const mb = Math.round(Number(entry.size) / 1024 / 1024);
    console.log(`${label} skipping "${entry.name}" -- ${mb}MB exceeds the ${MAX_FILE_BYTES / 1024 / 1024}MB guard`);
    return;
  }
  const destPath = path.join(destDir, sanitize(entry.name));
  console.log(`${label} downloading "${entry.name}" -> ${destPath}`);
  await downloadFile(entry.id, destPath);
}

async function main() {
  // Set by the admin UI's "Post now" buttons, to scope a run to one project
  // (and optionally force one specific channel within it) instead of the
  // default cron behavior of looping every project.
  const forceProjectId = process.env['FORCE_PROJECT_ID'];
  const forceChannelId = process.env['FORCE_CHANNEL_ID'];

  for (const project of await loadProjects()) {
    if (forceProjectId && forceProjectId !== project.id) continue;

    const channels = await loadChannels(project.id);

    for (const channel of channels) {
      const forced = forceChannelId === channel.id;
      if (!channel.enabled && !forced) continue;

      const label = `[${project.id}/${channel.id}]`;
      const newEntries = await listNewEntries(channel.driveFolderId, channel.syncedDriveFileIds);
      if (newEntries.length === 0) {
        console.log(`${label} no new files`);
        continue;
      }

      for (const entry of newEntries) {
        const postDir = path.join(inboxRoot(project.id), channel.id, postFolderName(entry));

        if (isFolder(entry)) {
          const children = await listFolderChildren(entry.id);
          if (children.length === 0) {
            console.log(`${label} "${entry.name}" is an empty folder, skipping`);
          } else {
            console.log(`${label} syncing carousel "${entry.name}" (${children.length} item(s))`);
            for (const child of children) {
              await downloadEntry(child, postDir, label);
            }
          }
        } else {
          await downloadEntry(entry, postDir, label);
        }

        // The whole top-level entry (file or folder) counts as synced once
        // processed, even if an individual oversized child got skipped --
        // re-syncing wouldn't recover it since Drive's file hasn't changed.
        channel.syncedDriveFileIds.push(entry.id);
      }
    }

    await saveChannels(project.id, channels);
  }

  console.log('sync-drive complete');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
