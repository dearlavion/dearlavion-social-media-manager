export type Platform = 'instagram' | 'tiktok' | 'pinterest' | 'facebook';

export const PLATFORMS: Platform[] = ['instagram', 'tiktok', 'pinterest', 'facebook'];

export interface ChannelConfig {
  id: string;
  platform: Platform;
  enabled: boolean;
  intervalHours: number;
  driveFolderId: string;
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
    captionTemplate: '',
    syncedDriveFileIds: [],
    lastPostedAt: null,
  };
}
