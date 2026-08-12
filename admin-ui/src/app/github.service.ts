import { Injectable } from '@angular/core';
import { ChannelConfig } from './channel.model';

export interface GithubConnection {
  owner: string;
  repo: string;
  branch: string;
  token: string;
}

const CONFIG_PATH = 'config/channels.json';

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
  private contentsUrl(conn: GithubConnection): string {
    return `https://api.github.com/repos/${conn.owner}/${conn.repo}/contents/${CONFIG_PATH}?ref=${encodeURIComponent(conn.branch)}`;
  }

  private headers(conn: GithubConnection): HeadersInit {
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
    const token = conn.token.trim();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  async loadChannels(conn: GithubConnection): Promise<{ channels: ChannelConfig[]; sha: string }> {
    const res = await fetch(this.contentsUrl(conn), { headers: this.headers(conn) });
    if (!res.ok) {
      throw new Error(`GitHub API error loading ${CONFIG_PATH}: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as { content: string; sha: string };
    const channels = JSON.parse(base64ToUtf8(body.content)) as ChannelConfig[];
    return { channels, sha: body.sha };
  }

  async saveChannels(conn: GithubConnection, channels: ChannelConfig[], sha: string): Promise<string> {
    const content = utf8ToBase64(JSON.stringify(channels, null, 2) + '\n');
    const res = await fetch(this.contentsUrl(conn), {
      method: 'PUT',
      headers: { ...this.headers(conn), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'chore: update social media channel config',
        content,
        sha,
        branch: conn.branch,
      }),
    });
    if (!res.ok) {
      throw new Error(`GitHub API error saving ${CONFIG_PATH}: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as { content: { sha: string } };
    return body.content.sha;
  }

  /**
   * Triggers a workflow_dispatch run (same as clicking "Run workflow" on the
   * Actions tab). Requires a token with the "Actions: write" permission in
   * addition to Contents. Does not force a post outside its due-check --
   * it just runs the workflow right now instead of waiting for its cron.
   */
  async triggerWorkflow(conn: GithubConnection, workflowFile: string): Promise<void> {
    const url = `https://api.github.com/repos/${conn.owner}/${conn.repo}/actions/workflows/${workflowFile}/dispatches`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...this.headers(conn), 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: conn.branch }),
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
    { timeoutMs = 180000, intervalMs = 4000 }: { timeoutMs?: number; intervalMs?: number } = {},
  ): Promise<WorkflowRun> {
    const sinceMs = Date.now();
    await this.triggerWorkflow(conn, workflowFile);

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
