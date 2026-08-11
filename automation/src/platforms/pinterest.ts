import type { PublishFn } from '../config.js';
import { DRY_RUN } from '../config.js';

/**
 * Pinterest API v5 — create a pin from a public image URL.
 * https://developers.pinterest.com/docs/api/v5/#operation/pins/create
 */
export const publish: PublishFn = async ({ publicImageUrl, caption }) => {
  const boardId = process.env['PINTEREST_BOARD_ID'];
  const accessToken = process.env['PINTEREST_ACCESS_TOKEN'];
  if (!boardId || !accessToken) {
    throw new Error('PINTEREST_BOARD_ID / PINTEREST_ACCESS_TOKEN env vars are not set');
  }

  if (DRY_RUN) {
    console.log(`[DRY_RUN][pinterest] would create pin on board ${boardId} from ${publicImageUrl} with description "${caption}"`);
    return;
  }

  const res = await fetch('https://api.pinterest.com/v5/pins', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      board_id: boardId,
      description: caption,
      media_source: {
        source_type: 'image_url',
        url: publicImageUrl,
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`Pinterest publish failed: ${res.status} ${await res.text()}`);
  }
};
