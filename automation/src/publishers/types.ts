import type { ChannelConfig } from '../config.js';

export interface PostMedia {
  type: 'image' | 'video';
  url: string;
}

export interface PublishParams {
  /** One item = single post; 2+ = carousel. All items share one caption. */
  media: PostMedia[];
  caption: string;
  channel: ChannelConfig;
}

export type PublishFn = (params: PublishParams) => Promise<void>;
