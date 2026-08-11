import type { PublishFn } from '../config.js';
import { DRY_RUN } from '../config.js';

/**
 * Instagram Graph API — two-step publish. The media container endpoint
 * takes a public image_url, not a binary upload, so this requires the repo
 * (or at least the inbox/ folder) to be publicly reachable via
 * raw.githubusercontent.com. See README for the account/app requirements.
 * https://developers.facebook.com/docs/instagram-platform/content-publishing
 */
export const publish: PublishFn = async ({ publicImageUrl, caption }) => {
  const igUserId = process.env['INSTAGRAM_BUSINESS_ACCOUNT_ID'];
  const accessToken = process.env['INSTAGRAM_ACCESS_TOKEN'];
  if (!igUserId || !accessToken) {
    throw new Error('INSTAGRAM_BUSINESS_ACCOUNT_ID / INSTAGRAM_ACCESS_TOKEN env vars are not set');
  }

  if (DRY_RUN) {
    console.log(`[DRY_RUN][instagram] would create media container for ${publicImageUrl} with caption "${caption}", then publish it`);
    return;
  }

  const base = `https://graph.facebook.com/v19.0/${igUserId}`;

  const createRes = await fetch(
    `${base}/media?image_url=${encodeURIComponent(publicImageUrl)}&caption=${encodeURIComponent(caption)}&access_token=${accessToken}`,
    { method: 'POST' },
  );
  if (!createRes.ok) {
    throw new Error(`Instagram media container failed: ${createRes.status} ${await createRes.text()}`);
  }
  const { id: creationId } = (await createRes.json()) as { id: string };

  const publishRes = await fetch(
    `${base}/media_publish?creation_id=${creationId}&access_token=${accessToken}`,
    { method: 'POST' },
  );
  if (!publishRes.ok) {
    throw new Error(`Instagram media_publish failed: ${publishRes.status} ${await publishRes.text()}`);
  }
};
