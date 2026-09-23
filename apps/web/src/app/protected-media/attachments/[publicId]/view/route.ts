import { forwardFile } from '../../../forward';

const PUBLIC_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request, { params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params;
  if (!PUBLIC_ID.test(publicId)) return new Response(null, { status: 404 });
  const download = new URL(request.url).searchParams.has('download') ? '?download=1' : '';
  return forwardFile(request, `/attachments/${publicId}/view${download}`);
}
