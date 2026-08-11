export type Platform = 'instagram' | 'tiktok' | 'facebook';

export const PLATFORMS: Platform[] = ['instagram', 'tiktok', 'facebook'];

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
  };
}
