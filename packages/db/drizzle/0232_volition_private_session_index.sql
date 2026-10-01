UPDATE "knowledge_item" AS item
SET "visibility" = 'private', "owner_id" = agent."user_id"
FROM "helena_agent_session" AS session
JOIN "ai_agent" AS agent ON agent."id" = session."agent_id"
WHERE item."source" = 'agent-session'
  AND item."item_id" = session."id"::text
  AND (session."kind" <> 'run' OR session."chat_thread_id" IS NOT NULL)
  AND (item."visibility" <> 'private' OR item."owner_id" IS DISTINCT FROM agent."user_id");
