<!-- Draft (package G). Moves to the public docs at the public cut. -->

# Connecting Google accounts

Helena reaches a Google account through **Access & connections → Google**:
- **Services:** Mail, Calendar, Drive, Docs, Sheets, Contacts and Tasks.
- **Inbox:** the account's mailbox appears in Helena's inbox, and no app password is
  needed.
- **Agents:** they use the account through Helena's tools, and only when you grant it to
  them.
- **Approvals:** sending, sharing and deleting wait for your approval.

Helena uses Google's official libraries (`google-auth-library` and the `@googleapis/*`
clients) and keeps the sign-in encrypted in its own store. Nothing else is needed on the
server.

## 1. Create an OAuth client (once)

1. Open <https://console.cloud.google.com/> and create a project, or pick one.
2. **APIs & Services → Library:** enable the APIs of the services you want:
   - Gmail API
   - Google Calendar API
   - Google Drive API
   - Google Docs API
   - Google Sheets API
   - People API
   - Google Tasks API
3. **APIs & Services → OAuth consent screen:**
   - Pick **Internal** if all accounts belong to your Google Workspace domain.
   - Otherwise pick **External**, add yourself as a test user, then **Publish app**.

   An external app left in *Testing* loses its sign-ins after 7 days. Google shows an
   "unverified app" warning on consent for a published app that is not verified. For
   your own accounts that is expected: continue through *Advanced*.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Choose **Desktop app**. It works for any Helena, including one on your LAN over
     plain http.
   - Choose **Web application** only if Helena runs on https. Then add
     `https://<your-api-host>/connectors/google/oauth/callback` as an authorized
     redirect URI.
5. **Download JSON.**

## 2. Import the client file

In Helena, go to **Access & connections → Google → Import OAuth client** and pick the
file. Helena stores the client secret encrypted and never shows it again.

## 3. Connect each account

**Connect account**:
1. Pick the client.
2. Optionally give the address.
3. Tick the services.
4. Choose whether the account belongs to the whole team or to one project.
5. **Continue**, then **Sign in at Google**.

With a Desktop client, the browser ends on a page on `127.0.0.1` that does not load after
you sign in. That is intended. Copy the page's full address from the address bar, paste
it into Helena and choose **Finish**. You can sign in on any device, for example your
phone, and paste the address on another.

With a Web client on https, Google returns to Helena by itself.

## 4. Grant it and pick the services

On the account's row:
- **Services** switches single services on or off. With **Mail** on, the account's
  mailbox appears in the inbox. It fetches the last 30 days by default; change that under
  *Fetch window*. **Reset** on the mailbox deletes the imported copies and imports again.
  The mail on the server stays.
- **Access** grants the account to single agents or to every agent of a project:
  - for all services or one
  - to read only, or to write as well
- **Check** asks Google whether the sign-in still works. If Google revoked it, or a
  service needs a scope the sign-in did not cover, the row asks you to **Sign in again**.

Every use shows in **Access & connections → Log**:
- tool calls
- refusals
- approval requests
- your own changes

## Scopes Helena asks for

| Service | Scope |
|---|---|
| (always) | `openid`, `userinfo.email` |
| Mail | `https://mail.google.com/` (IMAP and SMTP accept an OAuth token only with it) |
| Calendar | `…/auth/calendar` |
| Drive | `…/auth/drive` |
| Docs | `…/auth/documents` |
| Sheets | `…/auth/spreadsheets` |
| Contacts | `…/auth/contacts` |
| Tasks | `…/auth/tasks` |

## Optional: accounts kept in gog

If the server already holds Google sign-ins in the keyring of
[gog](https://github.com/steipete/gogcli) (MIT), Helena can use them without a new
consent:
1. Install the broker with `deployment/…/native/google/setup.sh`.
2. Set `HELENA_GOOGLE_BROKER="sudo -n -u volition-google /usr/local/libexec/helena-google-broker"`
   for the API and the worker.
3. The Google tab then lists gog's accounts under *In gog, not listed yet*.

Limits of a gog account:
- **No inbox.** gog cannot hand out an access token without exporting its refresh token.
- **Fewer tools.** Mail search, reading and sending, trash, calendar events and contact
  search work.

**Move to Helena** signs the account in again with Helena's own client and then removes
the token from gog, so no token lives twice.
