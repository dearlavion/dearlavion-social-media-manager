import path from 'node:path';
import { loadProjects, loadChannels, saveChannels, inboxRoot } from './config.js';
import { listNewEntries, listFolderChildren, isFolder } from './drive.js';
import { postFolderName, downloadEntry } from './drive-sync-helpers.js';
export { MAX_FILE_BYTES, exceedsSizeGuard } from './drive-sync-helpers.js';

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
