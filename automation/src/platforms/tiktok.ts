import type { PublishFn } from '../config.js';
import { DRY_RUN } from '../config.js';

/**
 * TikTok Content Posting API — photo post, pulling the image from a public
 * URL. NOTE: direct/public posting is gated behind TikTok app review; a
 * newly-registered app can typically only post to your own account in an
 * unaudited/sandbox mode until approved. See README for details.
 * https://developers.tiktok.com/doc/content-posting-api-reference-photo-post
 */
export const publish: PublishFn = async ({ publicImageUrl, caption }) => {
  const accessToken = process.env['TIKTOK_ACCESS_TOKEN'];
  if (!accessToken) {
    throw new Error('TIKTOK_ACCESS_TOKEN env var is not set');
  }

  if (DRY_RUN) {
    console.log(`[DRY_RUN][tiktok] would init photo post from ${publicImageUrl} with title "${caption}"`);
    return;
  }

  const res = await fetch('https://open.tiktokapis.com/v2/post/publish/content/init/', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({
      post_info: {
        title: caption,
        privacy_level: 'SELF_ONLY',
        disable_comment: false,
      },
      source_info: {
        source: 'PULL_FROM_URL',
        photo_images: [publicImageUrl],
      },
      post_mode: 'DIRECT_POST',
      media_type: 'PHOTO',
    }),
  });
  if (!res.ok) {
    throw new Error(`TikTok publish failed: ${res.status} ${await res.text()}`);
  }
};
