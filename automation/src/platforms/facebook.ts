import { readFile } from 'node:fs/promises';
import type { PublishFn } from '../config.js';
import { DRY_RUN } from '../config.js';

/**
 * Facebook Page photo post — direct binary upload, no public URL needed.
 * https://developers.facebook.com/docs/graph-api/reference/page/photos/
 */
export const publish: PublishFn = async ({ imagePath, caption }) => {
  const pageId = process.env['FACEBOOK_PAGE_ID'];
  const accessToken = process.env['FACEBOOK_PAGE_ACCESS_TOKEN'];
  if (!pageId || !accessToken) {
    throw new Error('FACEBOOK_PAGE_ID / FACEBOOK_PAGE_ACCESS_TOKEN env vars are not set');
  }

  if (DRY_RUN) {
    console.log(`[DRY_RUN][facebook] would POST /${pageId}/photos with caption "${caption}" and file ${imagePath}`);
    return;
  }

  const bytes = await readFile(imagePath);
  const form = new FormData();
  form.append('caption', caption);
  form.append('access_token', accessToken);
  form.append('source', new Blob([bytes]), imagePath.split('/').pop());

  const res = await fetch(`https://graph.facebook.com/v19.0/${pageId}/photos`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    throw new Error(`Facebook publish failed: ${res.status} ${await res.text()}`);
  }
};
