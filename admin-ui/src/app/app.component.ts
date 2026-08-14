import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ChannelConfig, Project, PLATFORMS, INSTAGRAM_POST_TYPES, PUBLISHERS, newChannel } from './channel.model';
import { GithubConnection, GithubService } from './github.service';
import { WikiComponent } from './wiki.component';
import { SchedulerComponent } from './scheduler.component';
import { QueueComponent } from './queue.component';
import { CampaignComponent } from './campaign.component';

const CONNECTION_STORAGE_KEY = 'dl-smm-admin-connection';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, WikiComponent, SchedulerComponent, QueueComponent, CampaignComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent implements OnInit {
  readonly platforms = PLATFORMS;
  readonly instagramPostTypes = INSTAGRAM_POST_TYPES;
  readonly publishers = PUBLISHERS;

  view: 'dashboard' | 'wiki' | 'setup' | 'scheduler' | 'queue' | 'campaigns' = 'dashboard';

  connection: GithubConnection = {
    owner: 'dearlavion',
    repo: 'dearlavion-social-media-manager',
    branch: 'main',
    token: '',
  };

  projects: Project[] = [];
  projectsSha: string | null = null;
  projectsLoaded = false;
  loadingProjects = false;
  savingProject = false;
  selectedProjectId: string | null = null;
  newProjectId = '';
  newProjectName = '';

  channels: ChannelConfig[] = [];
  sha: string | null = null;

  loaded = false;
  loading = false;
  saving = false;
  postingNow = false;
  postingChannelId: string | null = null;
  statusMessage = '';
  errorMessage = '';

  get busy(): boolean {
    return (
      this.loading ||
      this.saving ||
      this.postingNow ||
      this.postingChannelId !== null ||
      this.loadingProjects ||
      this.savingProject
    );
  }

  get enabledCount(): number {
    return this.channels.filter((c) => c.enabled).length;
  }

  get selectedProject(): Project | undefined {
    return this.projects.find((p) => p.id === this.selectedProjectId);
  }

  constructor(private readonly github: GithubService) {}

  ngOnInit(): void {
    const saved = sessionStorage.getItem(CONNECTION_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<GithubConnection>;
      // Only apply saved fields that actually have a value, so a stale blank
      // save (e.g. from before defaults existed) can't clobber the defaults.
      this.connection = {
        owner: parsed.owner?.trim() || this.connection.owner,
        repo: parsed.repo?.trim() || this.connection.repo,
        branch: parsed.branch?.trim() || this.connection.branch,
        token: parsed.token ?? this.connection.token,
      };
    }
  }

  private persistConnection(): void {
    sessionStorage.setItem(CONNECTION_STORAGE_KEY, JSON.stringify(this.connection));
  }

  async loadProjects(): Promise<void> {
    this.errorMessage = '';
    this.statusMessage = '';
    this.loadingProjects = true;
    try {
      this.persistConnection();
      const { projects, sha } = await this.github.loadProjects(this.connection);
      this.projects = projects;
      this.projectsSha = sha;
      this.projectsLoaded = true;
      // Switching the project list invalidates whatever channels were loaded before.
      this.selectedProjectId = null;
      this.loaded = false;
      this.channels = [];
      this.sha = null;
      this.statusMessage = `Loaded ${projects.length} project(s) from ${this.connection.owner}/${this.connection.repo}@${this.connection.branch}.`;
    } catch (err) {
      this.errorMessage = err instanceof Error ? err.message : String(err);
    } finally {
      this.loadingProjects = false;
    }
  }

  selectProject(id: string): void {
    this.selectedProjectId = id;
    this.loaded = false;
    this.channels = [];
    this.sha = null;
    this.statusMessage = '';
    this.errorMessage = '';
  }

  async addProject(): Promise<void> {
    const id = this.newProjectId.trim();
    const name = this.newProjectName.trim();
    this.errorMessage = '';
    this.statusMessage = '';
    if (!id || !name) {
      this.errorMessage = 'Project id and name are both required.';
      return;
    }
    if (this.projects.some((p) => p.id === id)) {
      this.errorMessage = `A project with id "${id}" already exists.`;
      return;
    }
    if (this.projectsSha === null) return;

    this.savingProject = true;
    try {
      const updated = [...this.projects, { id, name }];
      this.projectsSha = await this.github.saveProjects(this.connection, updated, this.projectsSha);
      this.projects = updated;
      await this.github.createProjectChannelsFile(this.connection, id);
      this.newProjectId = '';
      this.newProjectName = '';
      this.statusMessage = `Added project "${name}". Switched to the Dashboard so you can load its channels.`;
      this.selectProject(id);
      this.view = 'dashboard';
    } catch (err) {
      this.errorMessage = err instanceof Error ? err.message : String(err);
    } finally {
      this.savingProject = false;
    }
  }

  async load(): Promise<void> {
    if (!this.selectedProjectId) return;
    this.errorMessage = '';
    this.statusMessage = '';
    this.loading = true;
    try {
      const { channels, sha } = await this.github.loadChannels(this.connection, this.selectedProjectId);
      // Backfill for channels saved before instagramPostType/publisher existed,
      // so the dropdowns show the same defaults the automation actually uses.
      this.channels = channels.map((c) => ({
        ...c,
        instagramPostType: c.platform === 'instagram' ? (c.instagramPostType ?? 'post') : c.instagramPostType,
        publisher: c.publisher ?? 'buffer',
      }));
      this.sha = sha;
      this.loaded = true;
      this.statusMessage = `Loaded ${channels.length} channel(s) for ${this.selectedProject?.name ?? this.selectedProjectId}.`;
    } catch (err) {
      this.errorMessage = err instanceof Error ? err.message : String(err);
    } finally {
      this.loading = false;
    }
  }

  async save(): Promise<void> {
    if (this.sha === null || !this.selectedProjectId) return;
    this.errorMessage = '';
    this.statusMessage = '';
    this.saving = true;
    try {
      this.sha = await this.github.saveChannels(this.connection, this.selectedProjectId, this.channels, this.sha);
      this.statusMessage = 'Saved to GitHub.';
    } catch (err) {
      this.errorMessage = err instanceof Error ? err.message : String(err);
    } finally {
      this.saving = false;
    }
  }

  private async runSyncThenPost(channelId?: string): Promise<void> {
    if (!this.selectedProjectId) return;
    this.errorMessage = '';
    this.statusMessage = '';
    const inputs: Record<string, string> = { project_id: this.selectedProjectId };
    if (channelId) inputs['channel_id'] = channelId;
    const scope = channelId ? `"${channelId}"` : `all enabled channels in "${this.selectedProjectId}"`;
    try {
      this.statusMessage = `Syncing Drive images for ${scope}… (this can take a minute)`;
      const syncRun = await this.github.triggerAndWait(this.connection, 'sync-drive.yml', inputs);
      if (syncRun.conclusion !== 'success') {
        throw new Error(
          `sync-drive.yml finished with "${syncRun.conclusion}", so posting was skipped. Check the run: ${syncRun.html_url}`,
        );
      }

      this.statusMessage = `Sync complete. Posting for ${scope}…`;
      const postRun = await this.github.triggerAndWait(this.connection, 'post.yml', inputs);

      this.statusMessage = `Done: sync-drive succeeded, post finished with "${postRun.conclusion}". Run: ${postRun.html_url}`;
      if (postRun.conclusion !== 'success') {
        this.errorMessage = `The post run itself reported "${postRun.conclusion}" -- check its log for the actual error.`;
      }
    } catch (err) {
      this.errorMessage = err instanceof Error ? err.message : String(err);
    }
  }

  async postNow(): Promise<void> {
    this.postingNow = true;
    try {
      await this.runSyncThenPost();
    } finally {
      this.postingNow = false;
    }
  }

  async postChannelNow(channel: ChannelConfig): Promise<void> {
    this.postingChannelId = channel.id;
    try {
      await this.runSyncThenPost(channel.id);
    } finally {
      this.postingChannelId = null;
    }
  }

  addChannel(): void {
    this.channels = [...this.channels, newChannel()];
  }

  removeChannel(index: number): void {
    this.channels = this.channels.filter((_, i) => i !== index);
  }
}
