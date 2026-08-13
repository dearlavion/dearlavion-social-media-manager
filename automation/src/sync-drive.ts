import path from 'node:path';
import { loadProjects, loadChannels, saveChannels, inboxRoot } from './config.js';
import { listNewFiles, downloadFile } from './drive.js';

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
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

      const newFiles = await listNewFiles(channel.driveFolderId, channel.syncedDriveFileIds);
      if (newFiles.length === 0) {
        console.log(`[${project.id}/${channel.id}] no new files`);
        continue;
      }

      for (const file of newFiles) {
        const prefix = new Date(file.createdTime ?? Date.now()).toISOString().replace(/[:.]/g, '-');
        const destName = `${prefix}-${sanitize(file.name)}`;
        const destPath = path.join(inboxRoot(project.id), channel.id, destName);

        console.log(`[${project.id}/${channel.id}] downloading "${file.name}" -> ${destPath}`);
        await downloadFile(file.id, destPath);
        channel.syncedDriveFileIds.push(file.id);
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
