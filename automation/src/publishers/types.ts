import type { ChannelConfig, InstagramPostType } from '../config.js';

export interface PostMedia {
  type: 'image' | 'video';
  url: string;
}

export interface PublishParams {
  /** One item = single post; 2+ = carousel. All items share one caption. */
  media: PostMedia[];
  caption: string;
  channel: ChannelConfig;
  /** Only meaningful when channel.platform is "instagram" -- set per campaign slot, not per channel. Defaults to "post" when absent. */
  instagramPostType?: InstagramPostType;
}

export type PublishFn = (params: PublishParams) => Promise<void>;
