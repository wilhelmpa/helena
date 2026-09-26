# Receipt source navigation

Prepared on `659449b4` in `codex/receipt-source-navigation`. No deployment or live data
change is part of this work. Root's integrated gate and owner-browser acceptance remain open.

## Behavior

The receipt detail links to its source mail and the tasks actually linked to that thread.
The mail destination uses the numeric Helena thread ID; each task destination uses its
project key and project-scoped sequence number. The existing **Datei öffnen** and **In Dateien
zeigen** actions continue to use the same canonical file. No attachment copies, schema
changes, new receipt store or provider/model calls are added.

`GET /projects/:projectKey/receipts/:receiptId` returns `sourceLinks` with message/thread IDs
and accessible task references, or null. A legacy attachment receipt resolves through its
attachment FK and checks the attachment's stored SHA/size. Other mail originals resolve the
stored message/thread pair, with positive int4 bounds. The current message must still exist,
be undeleted, and agree with the receipt's project/team and the thread's account. A stale or
inaccessible source leaves the receipt/file accessible and shows an unavailable-source message.

Receipt administration remains under the existing `projectAdmin` guard. Source links also
require the existing mail access check; task references require `work_items/read` and remain
in the receipt's project. A team manager without project task permission gets the mail link
but no task links. Public receipt DTOs no longer expose unchecked `details.mailSource`; the
stored JSON provenance remains intact and is used only by the resolver. Mutation DTOs carry
`sourceLinks:null`; the existing receipt-query invalidation refetches the authorized GET.

The receipt sheet/body/extraction message are split into one component per file. The source
links use the existing navigation helpers and translations in all ten receipt locales.

## Validation

Kingston, private PostgreSQL 65501 inside `heavy.sh --class test`, with EXIT-stop:

- 12 API integration tests, 128 assertions: 7 source-navigation cases plus all 5 existing
  receipt cases, including intake, repeat, concurrent original filing and monthly export.
- API and web TypeScript checks passed. Scoped ESLint from each app, including all receipt
  translations, passed without warnings. Changed-file Prettier and `git diff --check` passed.
- 4 real receipt-body render tests passed on Mac and Kingston. They cover mail and task
  destinations, the unchanged Files/Mail link, EML without a task, missing source and upload.
- Removing the project filter, mail ACL or task ACL independently makes its DB regression
  fail. Substituting message ID for thread ID or database issue ID for sequence number makes
  the respective UI regression fail. The source was restored and its SHA verified.

Private logs: `~/agent-work/receipt-source-navigation/{tests,web-tests,api-types,web-types,
api-lint,web-lint}.log`; mutation logs are under that directory's `source/mutation-*.log`.
PG65501 is stopped and its port is free. No further private heavy job is running.

## Root live acceptance after integration

In PRIV/FAM/VOL, **Belege → Offen → Alle Monate → receipt detail**, require the correct
**Quellmail öffnen** link and, only where an actual association exists, **Aufgabe KEY-N**.
Check the existing original-file action and integrated Files viewer against the reviewed
receipt SHA; folder presence and DB counts alone do not establish filing usability.

Legacy receipt 1 should resolve through attachment 335 to message 7235/thread 6951 in PRIV
when that mapping is still current. At the read-only checkpoint it has no linked task, as
do VOL messages 7206 and 7207: do not create tickets for acceptance. Preserve the linked-invoice
warning and separate payment original. Check actual existing linked tasks through their
internal detail pages and their return mail links; if no live linked example exists, record
that limitation alongside the private API/UI proof.

Inbox navigation can mark an unread message read; use an already-read source for a strictly
read-only browser check. API source resolution itself does not mark, file, classify or send
mail. Root alone applies the reviewed receipt manifests and the separate four-task cleanup.
