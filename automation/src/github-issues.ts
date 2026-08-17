import { DRY_RUN } from './config.js';

/**
 * Opens a GitHub issue as a richer, persistent companion to the "fail the
 * run so GitHub emails a notification" trick (reminders.ts / scheduled-posts.ts)
 * -- that email can't carry a custom body, only a link to the run's log.
 * This puts the actual message somewhere you'd naturally see it (GitHub's
 * own issue notifications, same settings page) and gives you something to
 * close once you've handled it.
 *
 * Deliberately non-throwing: creating this issue is a nice-to-have layered
 * on top of the notification that already works, so a permissions problem
 * or API hiccup here shouldn't take down the rest of the due-check run.
 */
export async function openNotificationIssue(title: string, body: string, labels: string[]): Promise<void> {
  if (DRY_RUN) {
    console.log(`(dry run) would open issue "${title}" with labels [${labels.join(', ')}]`);
    return;
  }

  const repo = process.env['GITHUB_REPOSITORY'];
  const token = process.env['GITHUB_TOKEN'];
  if (!repo || !token) {
    console.log(`::warning::Skipping issue creation for "${title}" -- GITHUB_REPOSITORY or GITHUB_TOKEN not set.`);
    return;
  }

  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title, body, labels }),
    });
    if (!res.ok) {
      console.log(`::warning::Failed to open issue "${title}": ${res.status} ${await res.text()}`);
      return;
    }
    const issue = (await res.json()) as { html_url: string };
    console.log(`Opened notification issue: ${issue.html_url}`);
  } catch (err) {
    console.log(`::warning::Failed to open issue "${title}": ${err instanceof Error ? err.message : String(err)}`);
  }
}
