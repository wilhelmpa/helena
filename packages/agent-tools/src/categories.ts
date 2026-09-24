import type { ActionCategory } from '@helena/sdk';

// What each integration tool does, as an @helena/sdk action category, which the policy
// decides on: reading an outside service is `read`; creating or changing a record there
// (a Notion page, a Gitea issue) is `write`; a message to a person is `send`; anything
// that appears publicly (an Instagram post, a public reply on Threads) is `publish`.
// Every tool has an entry; the registry refuses one without (see connectors.ts).
export const TOOL_CATEGORIES: Record<string, ActionCategory> = {
  firecrawl_crawl: 'read',
  firecrawl_extract: 'read',
  firecrawl_map: 'read',
  firecrawl_scrape: 'read',
  firecrawl_search: 'read',

  gitea_list_issues: 'read',
  gitea_create_issue: 'write',
  gitea_update_issue: 'write',
  gitea_comment_issue: 'write',

  instagram_account_insights: 'read',
  instagram_business_discovery: 'read',
  instagram_container_status: 'read',
  instagram_content_publishing_limit: 'read',
  instagram_get_account: 'read',
  instagram_get_comment: 'read',
  instagram_get_media: 'read',
  instagram_get_mentioned_comment: 'read',
  instagram_get_mentioned_media: 'read',
  instagram_hashtag_recent_media: 'read',
  instagram_hashtag_search: 'read',
  instagram_hashtag_top_media: 'read',
  instagram_list_comment_replies: 'read',
  instagram_list_comments: 'read',
  instagram_list_live_media: 'read',
  instagram_list_media: 'read',
  instagram_list_stories: 'read',
  instagram_list_tagged_media: 'read',
  instagram_media_children: 'read',
  instagram_media_insights: 'read',
  instagram_recently_searched_hashtags: 'read',
  // A container is a draft until it is published.
  instagram_create_carousel: 'write',
  instagram_create_media_container: 'write',
  instagram_update_media: 'write',
  instagram_hide_comment: 'write',
  instagram_publish_media: 'publish',
  instagram_publish_post: 'publish',
  instagram_create_comment: 'publish',
  instagram_reply_to_comment: 'publish',
  instagram_reply_to_mention: 'publish',
  instagram_delete_comment: 'delete',
  instagram_delete_media: 'delete',

  jina_classify: 'read',
  jina_deepsearch: 'read',
  jina_grounding: 'read',
  jina_reader: 'read',
  jina_rerank: 'read',
  jina_search: 'read',
  jina_segment: 'read',

  notion_read_comments: 'read',
  notion_read_page: 'read',
  notion_search: 'read',
  notion_add_comment: 'write',
  notion_create_page: 'write',
  notion_update_page: 'write',

  telegram_send: 'send',

  threads_get_conversation: 'read',
  threads_get_post: 'read',
  threads_get_profile: 'read',
  threads_keyword_search: 'read',
  threads_list_posts: 'read',
  threads_list_replies: 'read',
  threads_list_user_replies: 'read',
  threads_location_search: 'read',
  threads_media_insights: 'read',
  threads_pending_replies: 'read',
  threads_publishing_limit: 'read',
  threads_user_insights: 'read',
  // Hiding, unhiding, approving or ignoring a reply to one's own post.
  threads_manage_pending_reply: 'write',
  threads_manage_reply: 'write',
  threads_publish: 'publish',
  threads_reply: 'publish',
  threads_delete: 'delete',
};
