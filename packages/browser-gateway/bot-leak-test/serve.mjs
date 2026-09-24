import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const port = Number(process.argv[2] || 18779);
const file = path.join(import.meta.dirname, 'leak-test.html');
const body = fs.readFileSync(file);

http
  .createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(body);
  })
  .listen(port, '127.0.0.1', () => {
    console.log('serving leak-test.html on http://127.0.0.1:' + port);
  });
