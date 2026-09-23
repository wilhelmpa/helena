#!/usr/bin/python3 -I
"""A scripted OpenAI-compatible model for the Hermes end-to-end proof, on a Unix socket that the
test's agent units reach on their loopback (the test launcher forwards 127.0.0.1:8765 to it).

The first call of a run gets one `terminal` tool call with the command in MOCK_COMMAND; once
the conversation holds the tool's result, the model answers MOCK_ANSWER. Any other call (a
title, a summary) gets a short text. Every request is logged to stderr, without its content.
"""

from __future__ import annotations

import asyncio
import json
import os
import socket
import sys
import time

COMMAND = os.environ.get('MOCK_COMMAND', 'echo hello')
ANSWER = os.environ.get('MOCK_ANSWER', 'The proof files are written.')


def log(message: str) -> None:
    print(f'mock-model: {message}', file=sys.stderr, flush=True)


def reply(body: dict) -> tuple[dict | None, str | None]:
    """(tool call, text) for one chat completion request."""
    messages = body.get('messages') or []
    tools = [t.get('function', {}).get('name') for t in body.get('tools') or []]
    if any(message.get('role') == 'tool' for message in messages):
        return None, ANSWER
    if 'terminal' in tools:
        return {'id': 'call_proof_1', 'type': 'function',
                'function': {'name': 'terminal', 'arguments': json.dumps({'command': COMMAND, 'timeout': 60})}}, None
    return None, 'ok'


def completion(model: str, call: dict | None, text: str | None) -> dict:
    message = {'role': 'assistant', 'content': text}
    if call:
        message['tool_calls'] = [call]
    return {
        'id': f'chatcmpl-{int(time.time() * 1000)}', 'object': 'chat.completion', 'created': int(time.time()),
        'model': model,
        'choices': [{'index': 0, 'message': message, 'finish_reason': 'tool_calls' if call else 'stop'}],
        'usage': {'prompt_tokens': 10, 'completion_tokens': 5, 'total_tokens': 15},
    }


def stream_chunks(model: str, call: dict | None, text: str | None) -> list[dict]:
    base = {'id': f'chatcmpl-{int(time.time() * 1000)}', 'object': 'chat.completion.chunk',
            'created': int(time.time()), 'model': model}
    chunks = [{**base, 'choices': [{'index': 0, 'delta': {'role': 'assistant'}, 'finish_reason': None}]}]
    if call:
        chunks.append({**base, 'choices': [{'index': 0, 'delta': {'tool_calls': [{
            'index': 0, 'id': call['id'], 'type': 'function',
            'function': {'name': call['function']['name'], 'arguments': call['function']['arguments']}}]},
            'finish_reason': None}]})
    else:
        chunks.append({**base, 'choices': [{'index': 0, 'delta': {'content': text}, 'finish_reason': None}]})
    chunks.append({**base, 'choices': [{'index': 0, 'delta': {}, 'finish_reason': 'tool_calls' if call else 'stop'}],
                   'usage': {'prompt_tokens': 10, 'completion_tokens': 5, 'total_tokens': 15}})
    return chunks


async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    try:
        head = await reader.readuntil(b'\r\n\r\n')
        lines = head.decode('latin-1').split('\r\n')
        method, path, _ = lines[0].split(' ', 2)
        headers = {k.strip().lower(): v.strip() for k, _, v in (line.partition(':') for line in lines[1:] if line)}
        body = await reader.readexactly(int(headers.get('content-length', '0') or 0)) if method == 'POST' else b''
        if method == 'GET' and path.rstrip('/').endswith('/models'):
            payload = json.dumps({'object': 'list', 'data': [{'id': 'vpt-mock', 'object': 'model', 'owned_by': 'proof'}]})
            writer.write(f'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {len(payload)}\r\n'
                         f'Connection: close\r\n\r\n{payload}'.encode())
            log(f'{method} {path}')
            return
        request = json.loads(body or b'{}')
        call, text = reply(request)
        model = request.get('model', 'vpt-mock')
        log(f'{method} {path} stream={bool(request.get("stream"))} messages={len(request.get("messages") or [])} '
            f'answer={"tool:terminal" if call else "text"}')
        if request.get('stream'):
            writer.write(b'HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\n'
                         b'Connection: close\r\n\r\n')
            for chunk in stream_chunks(model, call, text):
                writer.write(f'data: {json.dumps(chunk)}\n\n'.encode())
            writer.write(b'data: [DONE]\n\n')
        else:
            payload = json.dumps(completion(model, call, text))
            writer.write(f'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {len(payload)}\r\n'
                         f'Connection: close\r\n\r\n{payload}'.encode())
    except (asyncio.IncompleteReadError, ValueError, ConnectionError) as error:
        log(f'bad request: {type(error).__name__}')
    finally:
        try:
            await writer.drain()
            writer.close()
        except (ConnectionError, OSError):
            pass


async def main() -> None:
    sock = socket.socket(fileno=3)
    server = await asyncio.start_unix_server(handle, sock=sock)
    async with server:
        await server.serve_forever()


if __name__ == '__main__':
    asyncio.run(main())
