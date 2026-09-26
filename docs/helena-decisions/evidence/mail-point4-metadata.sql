-- Point-4 read-only checkpoint: exact committed 42-message manifest, accounts 4/5/6.
-- Private output contains source storage paths/hashes, never subjects, bodies or credentials.
-- Run via tools/ksql.sh without -w; redirect to a new mode-0600 evidence file.
\pset format unaligned
\pset tuples_only on
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
WITH selected(message_id,account_id,project_key,include_body,attachment_ids) AS (VALUES
(6565,4,'PRIV',false,ARRAY[291]::int[]),
(6607,4,'PRIV',false,ARRAY[292]::int[]),
(6727,4,'PRIV',false,ARRAY[296,297]::int[]),
(6801,5,'FAM',false,ARRAY[300]::int[]),
(6835,4,'PRIV',false,ARRAY[301]::int[]),
(6836,4,'PRIV',false,ARRAY[302]::int[]),
(6837,4,'PRIV',false,ARRAY[303]::int[]),
(6838,4,'PRIV',false,ARRAY[304]::int[]),
(6917,4,'PRIV',false,ARRAY[305]::int[]),
(7030,4,'PRIV',false,ARRAY[312]::int[]),
(7032,4,'PRIV',false,ARRAY[314,315]::int[]),
(7064,6,'VOL',false,ARRAY[316,317]::int[]),
(7083,6,'VOL',false,ARRAY[318,319]::int[]),
(7091,6,'VOL',false,ARRAY[320]::int[]),
(7202,6,'VOL',false,ARRAY[331,332]::int[]),
(7235,4,'PRIV',false,ARRAY[335]::int[]),
(6301,4,'PRIV',true,ARRAY[]::int[]),
(6302,4,'PRIV',true,ARRAY[]::int[]),
(6303,4,'PRIV',true,ARRAY[]::int[]),
(6304,4,'PRIV',true,ARRAY[]::int[]),
(6326,4,'PRIV',true,ARRAY[]::int[]),
(6331,4,'PRIV',true,ARRAY[]::int[]),
(6464,4,'PRIV',true,ARRAY[]::int[]),
(6497,4,'PRIV',true,ARRAY[]::int[]),
(6498,4,'PRIV',true,ARRAY[]::int[]),
(6577,4,'PRIV',true,ARRAY[]::int[]),
(6580,4,'PRIV',true,ARRAY[]::int[]),
(6608,4,'PRIV',true,ARRAY[]::int[]),
(6690,4,'PRIV',true,ARRAY[]::int[]),
(6702,4,'PRIV',true,ARRAY[]::int[]),
(6707,4,'PRIV',true,ARRAY[]::int[]),
(6722,4,'PRIV',true,ARRAY[]::int[]),
(6739,4,'PRIV',true,ARRAY[]::int[]),
(6744,4,'PRIV',true,ARRAY[]::int[]),
(6871,4,'PRIV',true,ARRAY[]::int[]),
(6878,4,'PRIV',true,ARRAY[]::int[]),
(7016,4,'PRIV',true,ARRAY[]::int[]),
(7043,4,'PRIV',true,ARRAY[]::int[]),
(7060,6,'VOL',true,ARRAY[]::int[]),
(7078,6,'VOL',true,ARRAY[]::int[]),
(7206,6,'VOL',true,ARRAY[]::int[]),
(7207,6,'VOL',true,ARRAY[]::int[])), scoped_accounts AS (
 SELECT a.id,a.project_id,p.key,a.fetch_days,a.enabled,a.triage_enabled,a.sync_status,a.last_sync_at,a.reset_requested_at
 FROM mail_account a LEFT JOIN project p ON p.id=a.project_id WHERE a.id IN (4,5,6)
)
SELECT jsonb_build_object(
 'capturedAt',clock_timestamp(),
 'accounts',(SELECT jsonb_agg(jsonb_build_object(
   'id',a.id,'projectId',a.project_id,'projectKey',a.key,'fetchDays',a.fetch_days,'enabled',a.enabled,
   'triageEnabled',a.triage_enabled,'syncStatus',a.sync_status,'lastSyncAt',a.last_sync_at,'resetPending',a.reset_requested_at IS NOT NULL,
   'threads',(SELECT count(*) FROM mail_thread t WHERE t.account_id=a.id),
   'messages',(SELECT count(*) FROM mail_message m WHERE m.account_id=a.id),
   'messagesDeleted',(SELECT count(*) FROM mail_message m WHERE m.account_id=a.id AND m.deleted_at IS NOT NULL),
   'messagesActive',(SELECT count(*) FROM mail_message m WHERE m.account_id=a.id AND m.deleted_at IS NULL),
   'attachments',(SELECT count(*) FROM mail_attachment x JOIN mail_message m ON m.id=x.message_id WHERE m.account_id=a.id),
   'attachmentBytes',(SELECT coalesce(sum(x.size),0) FROM mail_attachment x JOIN mail_message m ON m.id=x.message_id WHERE m.account_id=a.id),
   'distinctAttachmentHashes',(SELECT count(DISTINCT x.sha256) FROM mail_attachment x JOIN mail_message m ON m.id=x.message_id WHERE m.account_id=a.id),
   'otherThreadProjects',(SELECT count(*) FROM mail_thread t WHERE t.account_id=a.id AND t.project_id IS DISTINCT FROM a.project_id),
   'pendingProviderActions',(SELECT count(*) FROM mail_action ma WHERE ma.account_id=a.id),
   'receipts',(SELECT count(*) FROM helena_receipt r WHERE r.project_id=a.project_id),
   'mailReceipts',(SELECT count(*) FROM helena_receipt r WHERE r.project_id=a.project_id AND r.source='mail'),
   'receiptStates',(SELECT jsonb_object_agg(state,n) FROM (SELECT r.status state,count(*) n FROM helena_receipt r WHERE r.project_id=a.project_id GROUP BY r.status) q),
   'belegeIndexedFiles',(SELECT count(*) FROM vault_entry v WHERE v.project_id=a.project_id AND v.kind='file' AND v.path LIKE 'Projects/'||a.key||'/Files/Belege/%'),
   'receiptProjectPathMismatch',(SELECT count(*) FROM helena_receipt r WHERE r.project_id=a.project_id AND r.vault_path NOT LIKE 'Projects/'||a.key||'/%')
 ) ORDER BY a.id) FROM scoped_accounts a),
 'archiveFolders',(SELECT jsonb_agg(jsonb_build_object('accountId',f.account_id,'folderId',f.id,'path',f.path,'sync',f.sync,'role',f.role,'uidValidity',f.uid_validity,'totalCount',f.total_count,'syncedCount',f.synced_count,'lastSyncedAt',f.last_synced_at) ORDER BY f.account_id,f.id) FROM mail_folder f WHERE f.account_id IN (4,5,6) AND f.role='all'),
 'selected',(SELECT jsonb_agg(jsonb_build_object(
  'messageId',s.message_id,'expectedAccountId',s.account_id,'expectedProjectKey',s.project_key,'includeBody',s.include_body,'attachmentIds',s.attachment_ids,
  'exists',m.id IS NOT NULL,'accountId',m.account_id,'threadId',m.thread_id,'projectKey',p.key,'deleted',m.deleted_at IS NOT NULL,
  'size',m.size,'rawKey',m.raw_key,
  'attachments',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'messageId',a.message_id,'size',a.size,'sha256',a.sha256,'vaultPath',a.vault_path) ORDER BY a.id),'[]'::jsonb) FROM mail_attachment a WHERE a.id=ANY(s.attachment_ids)),
  'linkedIssueIds',(SELECT coalesce(jsonb_agg(l.issue_id ORDER BY l.issue_id),'[]'::jsonb) FROM mail_thread_issue l WHERE l.thread_id=m.thread_id)
 ) ORDER BY s.account_id,s.message_id) FROM selected s LEFT JOIN mail_message m ON m.id=s.message_id LEFT JOIN mail_thread t ON t.id=m.thread_id LEFT JOIN project p ON p.id=t.project_id),
 'receipts',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'projectKey',p.key,'source',r.source,'attachmentId',r.mail_attachment_id,'vaultPath',r.vault_path,'size',r.size,'sha256',r.sha256,'status',r.status,'sourceMessageId',r.details#>'{mailSource,messageId}','sourceThreadId',r.details#>'{mailSource,threadId}','sourceKind',r.details#>'{mailSource,kind}') ORDER BY r.id),'[]'::jsonb) FROM helena_receipt r JOIN project p ON p.id=r.project_id WHERE p.key IN ('PRIV','FAM','VOL')),
 'canonicalIndex',(SELECT coalesce(jsonb_agg(jsonb_build_object('projectKey',p.key,'path',v.path,'kind',v.kind,'size',v.size_bytes,'sha256',v.sha256) ORDER BY v.path),'[]'::jsonb) FROM vault_entry v JOIN project p ON p.id=v.project_id WHERE p.key IN ('PRIV','FAM','VOL') AND v.path LIKE 'Projects/'||p.key||'/Files/Belege/%'),
 'reviewedTasks',(SELECT jsonb_agg(jsonb_build_object('messageId',m.id,'accountId',m.account_id,'threadId',m.thread_id,'threadProject',tp.key,
  'classificationId',c.id,'category',c.category,'needsReply',c.needs_reply,'createTask',c.create_task,'classificationIssueId',c.issue_id,'corrected',c.corrected_at IS NOT NULL,
  'linkedIssueId',l.issue_id,'issueProject',ip.key,'sequence',i.sequence_number,'state',pc.state_type,'columnId',i.column_id,'archived',i.archived_at IS NOT NULL,'hasHumanAssignee',i.assignee_user_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ai_agent a WHERE a.user_id=i.assignee_user_id),'issueUpdatedAt',i.updated_at) ORDER BY m.id,l.issue_id)
 FROM mail_message m JOIN mail_thread t ON t.id=m.thread_id JOIN project tp ON tp.id=t.project_id
 LEFT JOIN helena_mail_classification c ON c.message_id=m.id LEFT JOIN mail_thread_issue l ON l.thread_id=t.id
 LEFT JOIN issue i ON i.id=l.issue_id LEFT JOIN project ip ON ip.id=i.project_id LEFT JOIN project_column pc ON pc.id=i.column_id
 WHERE m.id IN (7258,7261,7260,7262)),
 'canceledColumns',(SELECT jsonb_agg(jsonb_build_object('projectKey',p.key,'columnId',c.id,'autoAssigneePresent',c.auto_assign_user_id IS NOT NULL) ORDER BY c.id) FROM project_column c JOIN project p ON p.id=c.project_id WHERE p.key='PRIV' AND c.state_type='canceled')
);
COMMIT;
