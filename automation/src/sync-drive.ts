import path from 'node:path';
import { loadChannels, saveChannels, INBOX_ROOT } from './config.js';
import { listNewFiles, downloadFile } from './drive.js';

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
}

async function main() {
  const channels = await loadChannels();

  for (const channel of channels) {
    if (!channel.enabled) continue;

    const newFiles = await listNewFiles(channel.driveFolderId, channel.syncedDriveFileIds);
    if (newFiles.length === 0) {
      console.log(`[${channel.id}] no new files`);
      continue;
    }

    for (const file of newFiles) {
      const prefix = new Date(file.createdTime ?? Date.now()).toISOString().replace(/[:.]/g, '-');
      const destName = `${prefix}-${sanitize(file.name)}`;
      const destPath = path.join(INBOX_ROOT, channel.id, destName);

      console.log(`[${channel.id}] downloading "${file.name}" -> ${destPath}`);
      await downloadFile(file.id, destPath);
      channel.syncedDriveFileIds.push(file.id);
    }
  }

  await saveChannels(channels);
  console.log('sync-drive complete');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
