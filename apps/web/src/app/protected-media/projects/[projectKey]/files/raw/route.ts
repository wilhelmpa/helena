import { fileQuery, forwardFile } from '../../../../forward';

const PROJECT_KEY = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectKey: string }> },
) {
  const { projectKey } = await params;
  const query = fileQuery(request, ['vault', 'code']);
  if (!PROJECT_KEY.test(projectKey) || !query) return new Response(null, { status: 404 });
  return forwardFile(request, `/projects/${projectKey}/files/raw?${query}`);
}
