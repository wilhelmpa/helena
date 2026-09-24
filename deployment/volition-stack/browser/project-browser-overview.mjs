// Home's "Browser" overview (design §5: a tile per project browser — preview, address, who
// controls it, status). Served by the router next to the live views:
//
//   GET /browser/api/overview                       every provisioned project browser
//   GET /browser/projects/<slug>/api/thumbnail      a small JPEG of its tab in front
//
// Both sit behind the same Plan login as the live view (nginx auth_request). The picture
// is DevTools' own capture of the page (Page.captureScreenshot): nothing runs in the page.
import { CdpConnection, listTabs } from "./project-browser-control.mjs";
import { controlStateOf } from "./project-browser-screencast.mjs";

const THUMBNAIL_WIDTH = 480;
const THUMBNAIL_TTL_MS = 5_000;
const TIMEOUT_MS = 5_000;
const thumbnails = new Map(); // cdpPort -> { at, jpeg }

// One entry per project browser: its slug, the tab in front, and the gateway's state.
export async function browserOverview(browsers) {
  return Promise.all(
    browsers.map(async ({ slug, cdpPort }) => {
      const tabs = await listTabs(cdpPort).catch(() => null);
      const front = tabs?.find((tab) => tab.active) ?? tabs?.[0] ?? null;
      const { control, handover } = controlStateOf(cdpPort);
      return {
        slug,
        reachable: tabs !== null,
        url: front?.url ?? null,
        title: front?.title ?? null,
        tabCount: tabs?.length ?? 0,
        control,
        handover,
      };
    }),
  );
}

async function pageSocketUrl(cdpPort) {
  const response = await fetch(`http://127.0.0.1:${cdpPort}/json/list`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const targets = await response.json();
  const tabs = await listTabs(cdpPort);
  const front = tabs.find((tab) => tab.active) ?? tabs[0];
  const target = Array.isArray(targets) ? targets.find((entry) => entry.id === front?.id) : null;
  return target?.webSocketDebuggerUrl ?? null;
}

// A JPEG of the tab in front, at most THUMBNAIL_WIDTH CSS pixels wide, kept for a few
// seconds so a page of tiles polling it does not make every browser capture again and again.
export async function browserThumbnail(cdpPort) {
  const cached = thumbnails.get(cdpPort);
  if (cached && Date.now() - cached.at < THUMBNAIL_TTL_MS) return cached.jpeg;
  const socketUrl = await pageSocketUrl(cdpPort);
  if (!socketUrl) return null;
  const page = await CdpConnection.open(socketUrl);
  try {
    const metrics = await page.send("Page.getLayoutMetrics");
    // What is on screen: the visual viewport, at the page's scroll position.
    const viewport = metrics.cssVisualViewport ?? metrics.visualViewport ?? {};
    const width = Math.max(1, Math.round(viewport.clientWidth ?? 1280));
    const height = Math.max(1, Math.round(viewport.clientHeight ?? 800));
    const { data } = await page.send("Page.captureScreenshot", {
      format: "jpeg",
      quality: 60,
      optimizeForSpeed: true,
      clip: {
        x: viewport.pageX ?? 0,
        y: viewport.pageY ?? 0,
        width,
        height,
        scale: Math.min(1, THUMBNAIL_WIDTH / width),
      },
    });
    const jpeg = Buffer.from(data, "base64");
    thumbnails.set(cdpPort, { at: Date.now(), jpeg });
    return jpeg;
  } finally {
    page.close();
  }
}
