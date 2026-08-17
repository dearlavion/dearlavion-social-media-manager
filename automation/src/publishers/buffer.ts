import { DRY_RUN } from '../config.js';
import type { PublishFn, PostMedia } from './types.js';

/**
 * Buffer's assets field is an ordered list where each entry is exactly one
 * of image/video/document/link -- a carousel is just multiple entries.
 * https://developers.buffer.com/examples/create-video-post.html
 */
function toBufferAsset(item: PostMedia): Record<string, unknown> {
  if (item.type === 'video') {
    return { video: { url: item.url, metadata: { thumbnailOffset: 0 } } };
  }
  return { image: { url: item.url } };
}

const BUFFER_API_URL = 'https://api.buffer.com';

const CREATE_POST_MUTATION = `
  mutation CreatePost($input: CreatePostInput!) {
    createPost(input: $input) {
      ... on PostActionSuccess {
        post { id text }
      }
      ... on MutationError {
        message
      }
    }
  }
`;

interface CreatePostResult {
  createPost: {
    message?: string;
    post?: { id: string; text: string };
  };
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: { message: string }[];
}

async function bufferGraphQL<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const token = process.env['BUFFER_ACCESS_TOKEN'];
  if (!token) {
    throw new Error('BUFFER_ACCESS_TOKEN env var is not set');
  }

  const res = await fetch(BUFFER_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  const body = (await res.json()) as GraphQLResponse<T>;
  if (!res.ok || (body.errors && body.errors.length > 0)) {
    throw new Error(`Buffer API error: ${res.status} ${JSON.stringify(body.errors ?? body)}`);
  }
  return body.data as T;
}

/**
 * Publishes via Buffer (https://developers.buffer.com), which already holds
 * the OAuth connection to the real Instagram/TikTok/Facebook
 * account for this channel. mode: shareNow publishes immediately rather
 * than adding to Buffer's own queue, since our GitHub Actions cron is
 * already the thing deciding *when* to post.
 */
export const publish: PublishFn = async ({ media, caption, channel, instagramPostType }) => {
  if (!channel.bufferChannelId) {
    throw new Error(`Channel "${channel.id}" has no bufferChannelId configured`);
  }
  if (media.length === 0) {
    throw new Error(`Channel "${channel.id}": publish() called with no media`);
  }

  // Instagram requires an explicit post type (post/story/reel) plus
  // shouldShareToFeed -- both are non-optional in Buffer's schema, even
  // though only "reel" really has a meaningful choice here. Set per
  // campaign slot (Content Queue), not per channel -- defaults to "post"
  // for a synced post with no linked slot.
  const metadata =
    channel.platform === 'instagram'
      ? { instagram: { type: instagramPostType ?? 'post', shouldShareToFeed: true } }
      : undefined;

  const assets = media.map(toBufferAsset);

  if (DRY_RUN) {
    console.log(
      `[DRY_RUN][buffer] would post to Buffer channel ${channel.bufferChannelId} (${channel.platform}): ` +
        `"${caption}" with ${media.length} asset(s)=${JSON.stringify(assets)}${metadata ? `, metadata=${JSON.stringify(metadata)}` : ''}`,
    );
    return;
  }

  const result = await bufferGraphQL<CreatePostResult>(CREATE_POST_MUTATION, {
    input: {
      channelId: channel.bufferChannelId,
      text: caption,
      assets,
      mode: 'shareNow',
      schedulingType: 'automatic',
      ...(metadata ? { metadata } : {}),
    },
  });

  if (result.createPost.message) {
    throw new Error(`Buffer createPost failed: ${result.createPost.message}`);
  }

  console.log(`[${channel.id}] Buffer accepted the post: id=${result.createPost.post?.id}`);
};
