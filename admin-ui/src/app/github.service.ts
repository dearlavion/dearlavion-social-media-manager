import { Injectable } from '@angular/core';
import { ChannelConfig, Project } from './channel.model';
import { Reminder } from './reminder.model';

export interface GithubConnection {
  owner: string;
  repo: string;
  branch: string;
  token: string;
}

const PROJECTS_PATH = 'config/projects.json';
const REMINDERS_PATH = 'config/reminders.json';

function channelsPath(projectId: string): string {
  return `config/${projectId}/channels.json`;
}

function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

function base64ToUtf8(base64: string): string {
  const binary = atob(base64.replace(/\n/g, ''));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

@Injectable({ providedIn: 'root' })
export class GithubService {
  private contentsUrl(conn: GithubConnection, path: string): string {
    return `https://api.github.com/repos/${conn.owner}/${conn.repo}/contents/${path}?ref=${encodeURIComponent(conn.branch)}`;
  }

  private headers(conn: GithubConnection): HeadersInit {
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
    const token = conn.token.trim();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  private async getFile<T>(conn: GithubConnection, path: string): Promise<{ data: T; sha: string }> {
    const res = await fetch(this.contentsUrl(conn, path), { headers: this.headers(conn) });
    if (!res.ok) {
      throw new Error(`GitHub API error loading ${path}: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as { content: string; sha: string };
    return { data: JSON.parse(base64ToUtf8(body.content)) as T, sha: body.sha };
  }

  private async getFileOrDefault<T>(
    conn: GithubConnection,
    path: string,
    defaultValue: T,
  ): Promise<{ data: T; sha: string | null }> {
    const res = await fetch(this.contentsUrl(conn, path), { headers: this.headers(conn) });
    if (res.status === 404) {
      return { data: defaultValue, sha: null };
    }
    if (!res.ok) {
      throw new Error(`GitHub API error loading ${path}: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as { content: string; sha: string };
    return { data: JSON.parse(base64ToUtf8(body.content)) as T, sha: body.sha };
  }

  private async putFile(
    conn: GithubConnection,
    path: string,
    data: unknown,
    sha: string | null,
    message: string,
  ): Promise<string> {
    const content = utf8ToBase64(JSON.stringify(data, null, 2) + '\n');
    const res = await fetch(this.contentsUrl(conn, path), {
      method: 'PUT',
      headers: { ...this.headers(conn), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, content, branch: conn.branch, ...(sha ? { sha } : {}) }),
    });
    if (!res.ok) {
      throw new Error(`GitHub API error saving ${path}: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as { content: { sha: string } };
    return body.content.sha;
  }

  async loadProjects(conn: GithubConnection): Promise<{ projects: Project[]; sha: string }> {
    const { data, sha } = await this.getFile<Project[]>(conn, PROJECTS_PATH);
    return { projects: data, sha };
  }

  async saveProjects(conn: GithubConnection, projects: Project[], sha: string): Promise<string> {
    return this.putFile(conn, PROJECTS_PATH, projects, sha, 'chore: update projects registry');
  }

  /** Creates a brand-new project's channels.json (empty array) -- no sha needed since the file doesn't exist yet. */
  async createProjectChannelsFile(conn: GithubConnection, projectId: string): Promise<void> {
    await this.putFile(conn, channelsPath(projectId), [], null, `chore: add project ${projectId}`);
  }

  /** Falls back to an empty list if config/reminders.json doesn't exist yet on GitHub. */
  async loadReminders(conn: GithubConnection): Promise<{ reminders: Reminder[]; sha: string | null }> {
    const { data, sha } = await this.getFileOrDefault<Reminder[]>(conn, REMINDERS_PATH, []);
    return { reminders: data, sha };
  }

  async saveReminders(conn: GithubConnection, reminders: Reminder[], sha: string | null): Promise<string> {
    return this.putFile(conn, REMINDERS_PATH, reminders, sha, 'chore: update reminders');
  }

  async loadChannels(
    conn: GithubConnection,
    projectId: string,
  ): Promise<{ channels: ChannelConfig[]; sha: string }> {
    const { data, sha } = await this.getFile<ChannelConfig[]>(conn, channelsPath(projectId));
    return { channels: data, sha };
  }

  async saveChannels(
    conn: GithubConnection,
    projectId: string,
    channels: ChannelConfig[],
    sha: string,
  ): Promise<string> {
    return this.putFile(conn, channelsPath(projectId), channels, sha, 'chore: update social media channel config');
  }

  /**
   * Triggers a workflow_dispatch run (same as clicking "Run workflow" on the
   * Actions tab). Requires a token with the "Actions: write" permission in
   * addition to Contents. Does not force a post outside its due-check --
   * it just runs the workflow right now instead of waiting for its cron.
   */
  async triggerWorkflow(
    conn: GithubConnection,
    workflowFile: string,
    inputs?: Record<string, string>,
  ): Promise<void> {
    const url = `https://api.github.com/repos/${conn.owner}/${conn.repo}/actions/workflows/${workflowFile}/dispatches`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...this.headers(conn), 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: conn.branch, ...(inputs ? { inputs } : {}) }),
    });
    if (!res.ok) {
      throw new Error(`GitHub API error triggering ${workflowFile}: ${res.status} ${await res.text()}`);
    }
  }

  private async findRunSince(
    conn: GithubConnection,
    workflowFile: string,
    sinceMs: number,
  ): Promise<WorkflowRun | null> {
    const url = `https://api.github.com/repos/${conn.owner}/${conn.repo}/actions/workflows/${workflowFile}/runs?event=workflow_dispatch&per_page=5`;
    const res = await fetch(url, { headers: this.headers(conn) });
    if (!res.ok) {
      throw new Error(`GitHub API error listing runs for ${workflowFile}: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as { workflow_runs: WorkflowRun[] };
    // 5s slack for clock skew between this browser and GitHub's server.
    return body.workflow_runs.find((r) => new Date(r.created_at).getTime() >= sinceMs - 5000) ?? null;
  }

  /**
   * Triggers workflowFile and polls until the resulting run finishes,
   * returning its conclusion. Used to chain sync-drive -> post so "Post now"
   * can wait for the sync to actually land before posting from it.
   */
  async triggerAndWait(
    conn: GithubConnection,
    workflowFile: string,
    inputs?: Record<string, string>,
    { timeoutMs = 180000, intervalMs = 4000 }: { timeoutMs?: number; intervalMs?: number } = {},
  ): Promise<WorkflowRun> {
    const sinceMs = Date.now();
    await this.triggerWorkflow(conn, workflowFile, inputs);

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const run = await this.findRunSince(conn, workflowFile, sinceMs);
      if (run && run.status === 'completed') {
        return run;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error(
      `Timed out waiting for ${workflowFile} to finish. Check it directly: https://github.com/${conn.owner}/${conn.repo}/actions/workflows/${workflowFile}`,
    );
  }
}

export interface WorkflowRun {
  id: number;
  html_url: string;
  status: string;
  conclusion: string | null;
  created_at: string;
}
