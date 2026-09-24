// A Jev-compatible test server: `POST /v1/systemone` answered by src/task/mock-backend.ts,
// `GET /v1/models`, `GET /health`. For the eval harness, the API's integration tests and a first
// end-to-end check of a deployment without any key ("Jev-kompatibler Server" pointed at it).
// An optional key is checked like a real backend's Bearer token.
//
//   node packages/browser-gateway/eval/mock-server.ts [port] [key]
import http from 'node:http';
import { mockAnswers } from '../src/task/mock-backend.ts';

export function startMockServer(port: number, key: string | null = null): Promise<http.Server> {
  const server = http.createServer((request, response) => {
    const send = (status: number, body: unknown) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    if (key && request.headers.authorization !== `Bearer ${key}`) {
      return send(401, { detail: 'invalid or missing bearer token' });
    }
    const path = (request.url ?? '').split('?')[0];
    if (request.method === 'GET' && path === '/health')
      return send(200, { status: 'ok', model: 'mock-1' });
    if (request.method === 'GET' && path === '/v1/models') {
      return send(200, {
        models: [
          { name: 'mock-1', description: 'Helena test decisions', release_date: '2026-09-24' },
        ],
      });
    }
    if (request.method !== 'POST' || path !== '/v1/systemone')
      return send(404, { detail: 'not found' });
    let data = '';
    request.on('data', (chunk) => {
      data += chunk;
      if (data.length > 4_000_000) request.destroy();
    });
    request.on('end', () => {
      try {
        const body = JSON.parse(data);
        if (!body || typeof body !== 'object' || typeof body.questions !== 'object') {
          return send(422, { detail: "request body must be an object with a 'questions' field" });
        }
        send(200, mockAnswers(body));
      } catch {
        send(400, { detail: 'request body must be valid JSON' });
      }
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (import.meta.main) {
  const port = Number(process.argv[2] || 18651);
  const key = process.argv[3] || null;
  await startMockServer(port, key);
  console.log(
    `mock System One server on http://127.0.0.1:${port}${key ? ' (Bearer key required)' : ''}`,
  );
}
