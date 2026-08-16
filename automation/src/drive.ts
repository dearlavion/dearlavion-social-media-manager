import { google } from 'googleapis';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { DRY_RUN } from './config.js';

const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';

export interface DriveEntry {
  id: string;
  name: string;
  createdTime: string;
  mimeType: string;
  /** Bytes, as a string per the Drive API; absent for folders. */
  size?: string;
}

function isFolder(entry: DriveEntry): boolean {
  return entry.mimeType === FOLDER_MIME_TYPE;
}

export function isVideoEntry(entry: DriveEntry): boolean {
  return entry.mimeType.startsWith('video/');
}

function driveClient() {
  const raw = process.env['GDRIVE_SERVICE_ACCOUNT_JSON'];
  if (!raw) {
    throw new Error('GDRIVE_SERVICE_ACCOUNT_JSON env var is not set');
  }
  let credentials: object;
  try {
    credentials = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      'GDRIVE_SERVICE_ACCOUNT_JSON is not valid JSON. It must be the exact raw contents of the ' +
        'downloaded service account key file (starting with "{" and ending with "}"), pasted as-is ' +
        `into the GitHub secret -- no surrounding quotes added. Underlying error: ${(err as Error).message}`,
    );
  }
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
  return google.drive({ version: 'v3', auth });
}

/**
 * Lists the top-level entries of a channel's Drive folder that haven't been
 * synced yet -- both loose media files (each becomes a single-item post)
 * and subfolders (each becomes a carousel post, see listFolderChildren).
 */
export async function listNewEntries(folderId: string, alreadySyncedIds: string[]): Promise<DriveEntry[]> {
  if (DRY_RUN) {
    console.log(`[DRY_RUN] would list entries in Drive folder ${folderId}, excluding ${alreadySyncedIds.length} already-synced ids`);
    return [];
  }
  const drive = driveClient();
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false and (mimeType contains 'image/' or mimeType contains 'video/' or mimeType = '${FOLDER_MIME_TYPE}')`,
    fields: 'files(id, name, createdTime, mimeType, size)',
    orderBy: 'createdTime',
  });
  const entries = (res.data.files ?? []) as DriveEntry[];
  return entries.filter((e) => e.id && !alreadySyncedIds.includes(e.id));
}

/**
 * Looks up one file by its exact name directly inside a channel's Drive
 * folder -- used by scheduled-posts.ts to match a slot's `expectedFileName`
 * at post time, independent of the regular hourly sync-drive sweep. Exact,
 * case-sensitive match; returns the first hit if Drive somehow has more
 * than one file with that name in the folder.
 */
export async function findFileByName(folderId: string, fileName: string): Promise<DriveEntry | null> {
  if (DRY_RUN) {
    console.log(`[DRY_RUN] would look up file named "${fileName}" in Drive folder ${folderId}`);
    return null;
  }
  const escapedName = fileName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const drive = driveClient();
  const res = await drive.files.list({
    q: `'${folderId}' in parents and name = '${escapedName}' and trashed = false`,
    fields: 'files(id, name, createdTime, mimeType, size)',
  });
  const [first] = (res.data.files ?? []) as DriveEntry[];
  return first ?? null;
}

/** Lists the media files directly inside a carousel subfolder (one level, not recursive). */
export async function listFolderChildren(folderId: string): Promise<DriveEntry[]> {
  if (DRY_RUN) {
    console.log(`[DRY_RUN] would list children of Drive folder ${folderId}`);
    return [];
  }
  const drive = driveClient();
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false and (mimeType contains 'image/' or mimeType contains 'video/')`,
    fields: 'files(id, name, createdTime, mimeType, size)',
    orderBy: 'name',
  });
  return (res.data.files ?? []) as DriveEntry[];
}

export { isFolder };

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
