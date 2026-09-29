import { forwardFile, vaultPathQuery } from '../../../forward';

// The preview of a vault file (an office file as a PDF, an image, audio or video with
// ranges) loaded by the browser (O76). One fixed upstream, like the raw route: it forwards
// the session cookie, so the API alone decides what the reader may open.
export async function GET(request: Request) {
  const query = vaultPathQuery(request);
  if (!query) return new Response(null, { status: 404 });
  return forwardFile(request, `/knowledge/preview/file?${query}`);
}
