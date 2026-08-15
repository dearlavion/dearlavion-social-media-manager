import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChannelConfig, Project } from './channel.model';
import { GithubConnection, GithubService } from './github.service';
import { InboxPost, parseInboxTree } from './inbox-tree.util';
import { Campaign, LinkedSlot, findLinkedSlot, openSlotsForChannel } from './campaign.model';

interface QueuedPost extends InboxPost {
  estimatedAt: Date;
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

  // Campaign linking -- which slot (if any) each queued post already fulfils, and which open slots it could.
  private campaigns: Campaign[] = [];
  private campaignsSha: string | null = null;
  linking = false;

  constructor(private readonly github: GithubService) {}

  queueFor(channelId: string): QueuedPost[] {
    return this.queuesByChannel.get(channelId) ?? [];
  }

  rawUrl(path: string): string {
    return `https://raw.githubusercontent.com/${this.connection.owner}/${this.connection.repo}/${this.connection.branch}/${path}`;
  }

  linkedSlotFor(post: QueuedPost): LinkedSlot | undefined {
    return findLinkedSlot(this.campaigns, post.path);
  }

  openSlotsFor(post: QueuedPost): LinkedSlot[] {
    return openSlotsForChannel(this.campaigns, post.channelId);
  }

  async load(): Promise<void> {
    if (!this.project) return;
    this.errorMessage = '';
    this.loading = true;
    try {
      const [tree, { campaigns, sha }] = await Promise.all([
        this.github.loadTree(this.connection),
        this.github.loadCampaigns(this.connection, this.project.id),
      ]);
      this.queuesByChannel = this.buildQueues(parseInboxTree(tree, this.project.id));
      this.campaigns = campaigns;
      this.campaignsSha = sha;
      this.loaded = true;
    } catch (err) {
      this.errorMessage = err instanceof Error ? err.message : String(err);
    } finally {
      this.loading = false;
    }
  }

  async linkToCampaign(target: LinkedSlot, post: QueuedPost): Promise<void> {
    if (!this.project) return;
    this.errorMessage = '';
    this.linking = true;
    try {
      target.slot.linkedPostPath = post.path;
      target.slot.status = 'queued';
      this.campaignsSha = await this.github.saveCampaigns(this.connection, this.project.id, this.campaigns, this.campaignsSha);
    } catch (err) {
      this.errorMessage = err instanceof Error ? err.message : String(err);
    } finally {
      this.linking = false;
    }
  }

  private buildQueues(posts: InboxPost[]): Map<string, QueuedPost[]> {
    const byChannel = new Map<string, InboxPost[]>();
    for (const post of posts) {
      if (!byChannel.has(post.channelId)) byChannel.set(post.channelId, []);
      byChannel.get(post.channelId)!.push(post);
    }

    const result = new Map<string, QueuedPost[]>();
    for (const [channelId, channelPosts] of byChannel) {
      const channel = this.channels.find((c) => c.id === channelId);
      const intervalHours = channel?.intervalHours ?? 24;
      let cursor = this.firstEstimate(channel);

      result.set(
        channelId,
        channelPosts.map((post) => {
          const estimatedAt = new Date(cursor);
          cursor += intervalHours * 60 * 60 * 1000;
          return { ...post, estimatedAt };
        }),
      );
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
