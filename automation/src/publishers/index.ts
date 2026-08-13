import type { Publisher } from '../config.js';
import type { PublishFn } from './types.js';
import { publish as bufferPublish } from './buffer.js';

export type { PublishParams, PublishFn } from './types.js';

/**
 * Every posting backend a channel can target. "buffer" is the only one
 * implemented today -- add a new module here (matching PublishFn) and
 * register it to make it selectable in the admin UI's "Posting tool"
 * dropdown, no other wiring needed.
 */
const PUBLISHERS: Record<Publisher, PublishFn> = {
  buffer: bufferPublish,
};

export function getPublisher(id: Publisher): PublishFn {
  const fn = PUBLISHERS[id];
  if (!fn) {
    throw new Error(`Unknown publisher "${id}"`);
  }
  return fn;
}
