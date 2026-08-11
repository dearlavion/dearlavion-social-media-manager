import { google } from 'googleapis';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { DRY_RUN } from './config.js';

export interface DriveFile {
  id: string;
  name: string;
  createdTime: string;
}

function driveClient() {
  const raw = process.env['GDRIVE_SERVICE_ACCOUNT_JSON'];
  if (!raw) {
    throw new Error('GDRIVE_SERVICE_ACCOUNT_JSON env var is not set');
  }
  const credentials = JSON.parse(raw);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
  return google.drive({ version: 'v3', auth });
}

export async function listNewFiles(folderId: string, alreadySyncedIds: string[]): Promise<DriveFile[]> {
  if (DRY_RUN) {
    console.log(`[DRY_RUN] would list files in Drive folder ${folderId}, excluding ${alreadySyncedIds.length} already-synced ids`);
    return [];
  }
  const drive = driveClient();
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false and (mimeType contains 'image/')`,
    fields: 'files(id, name, createdTime)',
    orderBy: 'createdTime',
  });
  const files = (res.data.files ?? []) as DriveFile[];
  return files.filter((f) => f.id && !alreadySyncedIds.includes(f.id));
}

export async function downloadFile(fileId: string, destPath: string): Promise<void> {
  if (DRY_RUN) {
    console.log(`[DRY_RUN] would download Drive file ${fileId} to ${destPath}`);
    return;
  }
  const drive = driveClient();
  await mkdir(path.dirname(destPath), { recursive: true });
  const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });
  await new Promise<void>((resolve, reject) => {
    const dest = createWriteStream(destPath);
    res.data.on('end', resolve).on('error', reject).pipe(dest);
  });
}
