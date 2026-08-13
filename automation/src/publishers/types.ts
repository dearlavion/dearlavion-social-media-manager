import type { ChannelConfig } from '../config.js';

export interface PublishParams {
  publicImageUrl: string;
  caption: string;
  channel: ChannelConfig;
}

export type PublishFn = (params: PublishParams) => Promise<void>;
