// Manual live check of the scenario tools not exercised by the other manual e2e scripts:
// a second tab, a JS dialog, a file upload, and a download — the four design §9.2 names
// alongside login+2FA. Run: bun run scenario-check.manual.ts <cdpUrl> <pageUrl> <uploadFile>
import { PatchrightGatewaySession } from '@repo/browser-gateway';

const CDP_URL = process.argv[2] || 'http://127.0.0.1:19700';
const PAGE_URL = process.argv[3] || 'http://127.0.0.1:18700/';
const UPLOAD_FILE = process.argv[4]!;

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const session = await PatchrightGatewaySession.connect(CDP_URL, {
    vaultInbox: '/tmp',
    humanInput: false,
  });

  await session.navigate(PAGE_URL);

  // --- second tab ---
  const before = await session.tabs('list');
  check('tabs list starts with one tab', before.split('\n').length === 1, before);

  const snap = await session.snapshot();
  const tabBtnRef = snap.match(/\[e(\d+)\] button "Open second tab"/)?.[0]?.match(/e\d+/)?.[0];
  check('found the "open second tab" button in the snapshot', !!tabBtnRef, snap);
  if (tabBtnRef) {
    await session.click(tabBtnRef);
    await sleep(500);
    const after = await session.tabs('list');
    check('a second tab opened after the click', after.split('\n').length === 2, after);

    const focusTab = await session.tabs('focus', undefined, 't1');
    check('focused the second tab', focusTab.includes('Focused'), focusTab);
    const status = await session.status();
    check('status reflects two open tabs', status.tabCount === 2, JSON.stringify(status));

    const closeTab = await session.tabs('close', undefined, 't1');
    check('closed the second tab', closeTab.includes('Closed'), closeTab);
    await sleep(300);
    const afterClose = await session.tabs('list');
    check('back to one tab after closing it', afterClose.split('\n').length === 1, afterClose);
  }

  // --- dialog ---
  const snap2 = await session.snapshot();
  const dialogBtnRef = snap2.match(/\[e(\d+)\] button "Show dialog"/)?.[0]?.match(/e\d+/)?.[0];
  check('found the dialog button', !!dialogBtnRef, snap2);
  if (dialogBtnRef) {
    // Fire the click without awaiting the page's own script-blocking alert(); the dialog
    // handling itself has to race a listener the same way session.ts's dialogAction does.
    const clickPromise = session.click(dialogBtnRef);
    await sleep(300);
    const statusWithDialog = await session.status();
    check(
      'status reports a dialog is open',
      statusWithDialog.dialogOpen === true,
      JSON.stringify(statusWithDialog),
    );
    const handled = await session.dialogAction('accept');
    check('dialogAction accepted it', handled.includes('accepted'), handled);
    await clickPromise.catch(() => {});
    const statusAfterDialog = await session.status();
    check(
      'status reports the dialog is gone',
      statusAfterDialog.dialogOpen === false,
      JSON.stringify(statusAfterDialog),
    );
  }

  // --- upload ---
  const snap3 = await session.snapshot();
  const fileInputRef = snap3.match(/\[e(\d+)\] textbox:file/)?.[0]?.match(/e\d+/)?.[0];
  check('found the file input (or it has some textbox:* role)', !!fileInputRef, snap3);
  if (fileInputRef) {
    const uploaded = await session.upload(fileInputRef, UPLOAD_FILE);
    check('upload() succeeded', uploaded.includes('Uploaded'), uploaded);
  }

  // --- download ---
  const snap4 = await session.snapshot();
  const downloadRef = snap4.match(/\[e(\d+)\] link "Download a file"/)?.[0]?.match(/e\d+/)?.[0];
  check('found the download link', !!downloadRef, snap4);
  if (downloadRef) {
    await session.click(downloadRef);
    await sleep(1000);
    const downloads = await session.downloads();
    check('downloads() lists the downloaded file', downloads.includes('download.txt'), downloads);
  }

  await session.close();
  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('scenario check crashed:', error);
  process.exit(1);
});
