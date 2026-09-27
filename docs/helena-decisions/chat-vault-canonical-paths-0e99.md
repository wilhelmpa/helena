# Canonical vault paths from chat selection and upload

Prepared from `0e99cd6e40b1505fe067eb5b8cb05749a88805ab`. Web only; no server action.

Root's real VOL selection produced a Home link and failed to send. No message with that
attachment was persisted. The file API intentionally returns `FileItem.path` relative to
the selected root. ChatVaultFilePicker passed it unchanged to the composer, which uses it
both in `options.files` and optimistic attachment metadata. ChatAttachmentChip's
`vaultNotePath` expects `Projects/<KEY>/...` or `Home/...`, so a relative `Files/...` becomes
an incorrect Home link. The API correctly rejects it: chat `resolveFile` only accepts
Home, Templates or Projects and then checks the existing file permissions.

The upload path had the same mismatch: project-files upload returns root-relative item
paths, but useVaultUpload treated them as vault-relative. Both entry points now use the
same small chat-scope conversion before handing paths to the composer. Project keys use
the existing backend uppercase convention. Folder navigation in the picker remains
root-relative; only the selected file is qualified. Home chats get `Home/`, project chats
`Projects/<KEY>/`. Existing chatUploadScope consumers retain its export and behavior.

No API guard, composer protocol, chip fallback, stored message, filename, scope permission
or existing document is changed. There is no migration or retry of a failed live message.
The original failed UI draft must be reselected after deployment; merely retrying an old
relative-path draft is not an acceptance proof.

Local verification uses actual picker clicks, QueryClient/useVaultUpload and the actual
ChatAttachmentChip with mocked file HTTP responses and modal presentation. Project/Home
paths, folder traversal, upload return values and resulting hrefs pass. Independently
replacing either picker or upload hook by exact0e99 reproduces the corresponding relative
path failure. Pure tests cover project normalization and the full first folder in Home.
These are offline UI-contract proofs, not a successful production send or live ACL proof.

From `apps/web`, existing dependencies only:

```sh
bun test --preserve-symlinks --preload ./test/setup.ts --isolate src/features/ai-chat/components/workspace/ChatVaultFilePicker.test.tsx src/features/ai-chat/utils/chatVaultPaths.test.ts
bun ../../node_modules/typescript/bin/tsc --noEmit --preserveSymlinks -p tsconfig.json
NODE_OPTIONS='--preserve-symlinks --preserve-symlinks-main' node ../../node_modules/eslint/bin/eslint.js src/features/ai-chat/components/workspace/ChatVaultFilePicker.tsx src/features/ai-chat/components/workspace/ChatVaultFilePicker.test.tsx src/features/ai-chat/hooks/useVaultUpload.ts src/features/ai-chat/utils/chatVaultPaths.ts src/features/ai-chat/utils/chatVaultPaths.test.ts
```

Root acceptance: remove the failed draft attachment and select the existing synthetic
VOL Cycle.md again. The chip must link to `/project/VOL/files` with the full project-relative
folder/file, then ordinary send must persist a canonical `Projects/VOL/...` attachment and
reach the existing authorized agent. Home uses its own unchanged scope. No API relaxation
or direct database edit is required.
