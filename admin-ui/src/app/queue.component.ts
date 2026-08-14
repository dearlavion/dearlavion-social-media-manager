import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChannelConfig, Project } from './channel.model';
import { GithubConnection, GithubService, TreeEntry } from './github.service';

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.webm']);
const CAPTION_FILENAME = 'caption.txt';

interface QueuedPostFile {
  filename: string;
  path: string;
  isVideo: boolean;
}

interface QueuedPost {
  name: string;
  files: QueuedPostFile[];
  mediaType: 'image' | 'video' | 'carousel';
  hasCustomCaption: boolean;
  estimatedAt: Date;
}

function extname(filename: string): string {
  const i = filename.lastIndexOf('.');
  return i >= 0 ? filename.slice(i).toLowerCase() : '';
}

@Component({
  selector: 'app-queue',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './queue.component.html',
  styleUrl: './queue.component.css',
})
export class QueueComponent {
  @Input({ required: true }) connection!: GithubConnection;
  @Input() project: Project | null = null;
  @Input() channels: ChannelConfig[] = [];
  @Input() channelsLoaded = false;

  loading = false;
  loaded = false;
  errorMessage = '';
  private queuesByChannel = new Map<string, QueuedPost[]>();

  constructor(private readonly github: GithubService) {}

  queueFor(channelId: string): QueuedPost[] {
    return this.queuesByChannel.get(channelId) ?? [];
  }

  rawUrl(path: string): string {
    return `https://raw.githubusercontent.com/${this.connection.owner}/${this.connection.repo}/${this.connection.branch}/${path}`;
  }

  async load(): Promise<void> {
    if (!this.project) return;
    this.errorMessage = '';
    this.loading = true;
    try {
      const tree = await this.github.loadTree(this.connection);
      this.queuesByChannel = this.buildQueues(tree, this.project.id);
      this.loaded = true;
    } catch (err) {
      this.errorMessage = err instanceof Error ? err.message : String(err);
    } finally {
      this.loading = false;
    }
  }

  private buildQueues(tree: TreeEntry[], projectId: string): Map<string, QueuedPost[]> {
    const prefix = `inbox/${projectId}/`;
    // channelId -> postName -> files
    const byChannel = new Map<string, Map<string, QueuedPostFile[]>>();
    const captionedPosts = new Set<string>(); // "channelId/postName"

    for (const entry of tree) {
      if (entry.type !== 'blob' || !entry.path.startsWith(prefix)) continue;
      const parts = entry.path.slice(prefix.length).split('/');
      if (parts.length !== 3) continue; // expect <channelId>/<postName>/<filename>
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

    const result = new Map<string, QueuedPost[]>();
    for (const [channelId, posts] of byChannel) {
      const channel = this.channels.find((c) => c.id === channelId);
      const intervalHours = channel?.intervalHours ?? 24;
      let cursor = this.firstEstimate(channel);

      const queued = [...posts.keys()]
        .sort()
        .map((postName): QueuedPost => {
          const files = posts.get(postName)!.slice().sort((a, b) => a.filename.localeCompare(b.filename));
          const mediaType: QueuedPost['mediaType'] =
            files.length > 1 ? 'carousel' : files[0]?.isVideo ? 'video' : 'image';
          const estimatedAt = new Date(cursor);
          cursor += intervalHours * 60 * 60 * 1000;
          return {
            name: postName,
            files,
            mediaType,
            hasCustomCaption: captionedPosts.has(`${channelId}/${postName}`),
            estimatedAt,
          };
        });
      result.set(channelId, queued);
    }
    return result;
  }

  private firstEstimate(channel: ChannelConfig | undefined): number {
    const now = Date.now();
    if (!channel?.lastPostedAt) return now;
    const next = new Date(channel.lastPostedAt).getTime() + channel.intervalHours * 60 * 60 * 1000;
    return Math.max(next, now);
  }
}
