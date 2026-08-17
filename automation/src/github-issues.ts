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
 * Opens a GitHub issue as a richer, persistent companion to the "fail the
 * run so GitHub emails a notification" trick (reminders.ts / scheduled-posts.ts)
 * -- that email can't carry a custom body, only a link to the run's log.
 * This puts the actual message somewhere you'd naturally see it (GitHub's
 * own issue notifications, same settings page) and gives you something to
 * close once you've handled it. Left open -- for things that need your
 * attention (a reminder, a failed post, missing media).
 *
 * Deliberately non-throwing: creating this issue is a nice-to-have layered
 * on top of the notification that already works, so a permissions problem
 * or API hiccup here shouldn't take down the rest of the run.
 */
export async function openNotificationIssue(title: string, body: string, labels: string[]): Promise<void> {
  if (DRY_RUN) {
    console.log(`(dry run) would open issue "${title}" with labels [${labels.join(', ')}]`);
    return;
  }
  const issue = await createIssue(title, body, labels);
  if (issue) console.log(`Opened notification issue: ${issue.html_url}`);
}

/**
 * Same as openNotificationIssue, but immediately closed -- for routine
 * confirmations (a post that published successfully) that should still
 * notify without piling up in the open-issues list over time.
 */
export async function openAndCloseNotificationIssue(title: string, body: string, labels: string[]): Promise<void> {
  if (DRY_RUN) {
    console.log(`(dry run) would open+close issue "${title}" with labels [${labels.join(', ')}]`);
    return;
  }
  const issue = await createIssue(title, body, labels);
  if (!issue) return;
  console.log(`Opened notification issue: ${issue.html_url}`);
  await closeIssue(issue);
}
