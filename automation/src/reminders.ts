import { appendFileSync } from 'node:fs';
import { loadReminders, saveReminders } from './config.js';

/**
 * Finds reminders due by now, logs each one as a ::error:: annotation (so
 * it's visible at a glance on the Actions run page), marks them notified,
 * and saves. Does NOT exit non-zero itself -- that's a separate workflow
 * step conditioned on the "due" output this sets, so the commit of
 * notifiedAt always happens regardless of whether we go on to fail the job.
 */
async function main() {
  const reminders = await loadReminders();
  const now = new Date();

  const due = reminders.filter((r) => !r.notifiedAt && new Date(r.dueAt).getTime() <= now.getTime());

  if (due.length === 0) {
    console.log('No reminders due.');
    return;
  }

  for (const r of due) {
    console.log(`::error::⏰ REMINDER: ${r.message} (was due ${r.date} ${r.time})`);
    r.notifiedAt = now.toISOString();
  }

  await saveReminders(reminders);

  const githubOutput = process.env['GITHUB_OUTPUT'];
  if (githubOutput) {
    appendFileSync(githubOutput, 'due=true\n');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
