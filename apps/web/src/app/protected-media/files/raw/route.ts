import { fileQuery, forwardFile } from '../../forward';

export async function GET(request: Request) {
  const query = fileQuery(request, ['home', 'private', 'templates']);
  if (!query) return new Response(null, { status: 404 });
  return forwardFile(request, `/files/raw?${query}`);
}
