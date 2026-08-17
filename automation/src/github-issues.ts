import { DRY_RUN } from './config.js';

interface CreatedIssue {
  number: number;
  html_url: string;
}

function repoAndToken(): { repo: string; token: string } | null {
  const repo = process.env['GITHUB_REPOSITORY'];
  const token = process.env['GITHUB_TOKEN'];
  if (!repo || !token) return null;
  return { repo, token };
}

async function createIssue(title: string, body: string, labels: string[]): Promise<CreatedIssue | null> {
  const creds = repoAndToken();
  if (!creds) {
    console.log(`::warning::Skipping issue creation for "${title}" -- GITHUB_REPOSITORY or GITHUB_TOKEN not set.`);
    return null;
  }
  try {
    const res = await fetch(`https://api.github.com/repos/${creds.repo}/issues`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title, body, labels }),
    });
    if (!res.ok) {
      console.log(`::warning::Failed to open issue "${title}": ${res.status} ${await res.text()}`);
      return null;
    }
    return (await res.json()) as CreatedIssue;
  } catch (err) {
    console.log(`::warning::Failed to open issue "${title}": ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

async function closeIssue(issue: CreatedIssue): Promise<void> {
  const creds = repoAndToken();
  if (!creds) return; // createIssue already warned; nothing to close without credentials anyway
  try {
    const res = await fetch(`https://api.github.com/repos/${creds.repo}/issues/${issue.number}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${creds.token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ state: 'closed' }),
    });
    if (!res.ok) {
      console.log(`::warning::Opened issue ${issue.html_url} but failed to auto-close it: ${res.status} ${await res.text()}`);
    }
  } catch (err) {
    console.log(`::warning::Opened issue ${issue.html_url} but failed to auto-close it: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Opens a GitHub issue with the real message -- the richer notification
 * channel now, since it can carry a custom title/body where the "fail the
 * run so GitHub emails you" trick (reminders.ts / scheduled-posts.ts /
 * post.ts) only ever linked to a log. Left open -- for things that need
 * your attention (a reminder, a failed post, missing media).
 *
 * Returns whether the issue was actually created, so the caller can fail
 * the run (and trigger that email) as a *backup* specifically for when
 * this notification itself didn't get through -- not on every occurrence,
 * now that the issue is the primary channel.
 */
export async function openNotificationIssue(title: string, body: string, labels: string[]): Promise<boolean> {
  if (DRY_RUN) {
    console.log(`(dry run) would open issue "${title}" with labels [${labels.join(', ')}]`);
    return true;
  }
  const issue = await createIssue(title, body, labels);
  if (!issue) return false;
  console.log(`Opened notification issue: ${issue.html_url}`);
  return true;
}

/**
 * Same as openNotificationIssue, but immediately closed -- for routine
 * confirmations (a post that published successfully) that should still
 * notify without piling up in the open-issues list over time. There's no
 * backup-email path for these; a missed "it worked" confirmation isn't
 * worth failing an otherwise-successful run over.
 */
export async function openAndCloseNotificationIssue(title: string, body: string, labels: string[]): Promise<boolean> {
  if (DRY_RUN) {
    console.log(`(dry run) would open+close issue "${title}" with labels [${labels.join(', ')}]`);
    return true;
  }
  const issue = await createIssue(title, body, labels);
  if (!issue) return false;
  console.log(`Opened notification issue: ${issue.html_url}`);
  await closeIssue(issue);
  return true;
}
