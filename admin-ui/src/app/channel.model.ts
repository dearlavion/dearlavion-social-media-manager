export interface Project {
  id: string;
  name: string;
}

export type Platform = 'instagram' | 'tiktok' | 'facebook';

export const PLATFORMS: Platform[] = ['instagram', 'tiktok', 'facebook'];

/** Only meaningful when platform is "instagram" -- Buffer requires this on every Instagram post. */
export type InstagramPostType = 'post' | 'story' | 'reel';

export const INSTAGRAM_POST_TYPES: InstagramPostType[] = ['post', 'story', 'reel'];

/** Which backend actually publishes the post. Only "buffer" is implemented today -- see automation/src/publishers/. */
export type Publisher = 'buffer';

export const PUBLISHERS: Publisher[] = ['buffer'];

export interface ChannelConfig {
  id: string;
  platform: Platform;
  enabled: boolean;
  intervalHours: number;
  driveFolderId: string;
  bufferChannelId: string;
  captionTemplate: string;
  syncedDriveFileIds: string[];
  lastPostedAt: string | null;
  instagramPostType?: InstagramPostType;
  publisher?: Publisher;
}

export function newChannel(): ChannelConfig {
  return {
    id: '',
    platform: 'facebook',
    enabled: false,
    intervalHours: 6,
    driveFolderId: '',
    bufferChannelId: '',
    captionTemplate: '',
    syncedDriveFileIds: [],
    lastPostedAt: null,
    instagramPostType: 'post',
    publisher: 'buffer',
  };
}
