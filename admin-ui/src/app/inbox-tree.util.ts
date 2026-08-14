import type { TreeEntry } from './github.service';

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.webm']);
const CAPTION_FILENAME = 'caption.txt';

export interface InboxPostFile {
  filename: string;
  path: string;
  isVideo: boolean;
}

export interface InboxPost {
  channelId: string;
  name: string;
  path: string;
  files: InboxPostFile[];
  mediaType: 'image' | 'video' | 'carousel';
  hasCustomCaption: boolean;
}

function extname(filename: string): string {
  const i = filename.lastIndexOf('.');
  return i >= 0 ? filename.slice(i).toLowerCase() : '';
}

/**
 * Groups a repo's Git-Trees-API listing into inbox/<projectId>/<channelId>/<postId>/
 * post folders -- shared by the Content Queue view and the Campaign
 * "link a queued post" picker so both parse the same tree shape once,
 * oldest post first within each channel.
 */
export function parseInboxTree(tree: TreeEntry[], projectId: string): InboxPost[] {
  const prefix = `inbox/${projectId}/`;
  const byChannel = new Map<string, Map<string, InboxPostFile[]>>();
  const captionedPosts = new Set<string>();

  for (const entry of tree) {
    if (entry.type !== 'blob' || !entry.path.startsWith(prefix)) continue;
    const parts = entry.path.slice(prefix.length).split('/');
    if (parts.length !== 3) continue; // expect <channelId>/<postId>/<filename>
    const [channelId, postName, filename] = parts;

    if (filename === CAPTION_FILENAME) {
      captionedPosts.add(`${channelId}/${postName}`);
      continue;
    }

    if (!byChannel.has(channelId)) byChannel.set(channelId, new Map());
    const posts = byChannel.get(channelId)!;
    if (!posts.has(postName)) posts.set(postName, []);
    posts.get(postName)!.push({ filename, path: entry.path, isVideo: VIDEO_EXTENSIONS.has(extname(filename)) });
  }

  const result: InboxPost[] = [];
  for (const [channelId, posts] of byChannel) {
    for (const postName of [...posts.keys()].sort()) {
      const files = posts.get(postName)!.slice().sort((a, b) => a.filename.localeCompare(b.filename));
      const mediaType: InboxPost['mediaType'] = files.length > 1 ? 'carousel' : files[0]?.isVideo ? 'video' : 'image';
      result.push({
        channelId,
        name: postName,
        path: `inbox/${projectId}/${channelId}/${postName}`,
        files,
        mediaType,
        hasCustomCaption: captionedPosts.has(`${channelId}/${postName}`),
      });
    }
  }
  return result;
}
