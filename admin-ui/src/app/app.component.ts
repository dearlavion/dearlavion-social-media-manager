import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ChannelConfig, PLATFORMS, newChannel } from './channel.model';
import { GithubConnection, GithubService } from './github.service';

const CONNECTION_STORAGE_KEY = 'dl-smm-admin-connection';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent implements OnInit {
  readonly platforms = PLATFORMS;

  connection: GithubConnection = {
    owner: 'dearlavion',
    repo: 'dearlavion-social-media-manager',
    branch: 'main',
    token: '',
  };
  channels: ChannelConfig[] = [];
  sha: string | null = null;

  loaded = false;
  loading = false;
  saving = false;
  statusMessage = '';
  errorMessage = '';

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

  async load(): Promise<void> {
    this.errorMessage = '';
    this.statusMessage = '';
    this.loading = true;
    try {
      this.persistConnection();
      const { channels, sha } = await this.github.loadChannels(this.connection);
      this.channels = channels;
      this.sha = sha;
      this.loaded = true;
      this.statusMessage = `Loaded ${channels.length} channel(s) from ${this.connection.owner}/${this.connection.repo}@${this.connection.branch}.`;
    } catch (err) {
      this.errorMessage = err instanceof Error ? err.message : String(err);
    } finally {
      this.loading = false;
    }
  }

  async save(): Promise<void> {
    if (this.sha === null) return;
    this.errorMessage = '';
    this.statusMessage = '';
    this.saving = true;
    try {
      this.sha = await this.github.saveChannels(this.connection, this.channels, this.sha);
      this.statusMessage = 'Saved to GitHub.';
    } catch (err) {
      this.errorMessage = err instanceof Error ? err.message : String(err);
    } finally {
      this.saving = false;
    }
  }

  addChannel(): void {
    this.channels = [...this.channels, newChannel()];
  }

  removeChannel(index: number): void {
    this.channels = this.channels.filter((_, i) => i !== index);
  }
}
