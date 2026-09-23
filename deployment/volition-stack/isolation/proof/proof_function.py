"""Proofs that need the test Plan API: the Plan socket, the network modes, the function of the
runtimes (design §6.5) and the project terminal. Each reports through the harness's Report."""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request


def api(state: dict, method: str, path: str, key: str, body: dict | None = None) -> tuple[int, object]:
    """A call to the test Plan API from the host, as the owner or an agent."""
    request = urllib.request.Request(
        f'http://127.0.0.1:{state["planPort"]}{path}', method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={'x-api-key': key, 'content-type': 'application/json'},
    )
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(request, timeout=20) as response:
            return response.status, json.loads(response.read() or b'null')
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode(errors='replace')[:300]


def expect(report, test: str, results: dict, spec: str, want_ok: bool, contains: str | None = None,
           label: str | None = None) -> None:
    if '_error' in results:
        report.add(test, label or spec, False, results['_error'])
        return
    value = results.get(spec, {'ok': None, 'detail': 'missing'})
    ok = value['ok'] == want_ok and (contains is None or contains in value['detail'])
    report.add(test, label or spec, ok, value['detail'])


def hexed(text: str) -> str:
    return text.encode('latin-1').hex()


# ── Plan socket ──────────────────────────────────────────────────────────────────────────


def run_plan_socket_proofs(report, probe, keys) -> None:
    k = keys()
    env = {'ALPHA_KEY': k['alphaKey'], 'BETA_KEY': k['betaKey'], 'HOME_KEY': k['homeKey'],
           'OWNER_KEY': k['ownerKey'], 'OWNER_COOKIE': k['ownerCookie']}
    mcp = 'accept=application/json, text/event-stream'
    checks = {
        'plan:GET,/me,x-api-key=$ALPHA_KEY': (True, 'http=200', 'own agent key'),
        'plan:GET,/projects,x-api-key=$ALPHA_KEY': (True, 'http=200', 'own agent key, planner route'),
        'plan:GET,/projects,x-api-key=$BETA_KEY': (False, 'http=403', "another project's agent key"),
        'plan:GET,/projects,x-api-key=$HOME_KEY': (False, 'http=403', "the Home agent's key"),
        'plan:GET,/projects,x-api-key=$OWNER_KEY': (False, 'http=403', "the owner's personal key"),
        'plan:GET,/projects,cookie=$OWNER_COOKIE': (False, 'http=401', "the owner's session cookie (dropped)"),
        'plan:GET,/projects,x-api-key=$BETA_KEY,X-Volition-Agent-Project=beta':
            (False, 'http=403', 'forged project header is replaced'),
        'plan:GET,/projects,x-api-key=$ALPHA_KEY,X-Volition-Local-Access=x':
            (True, 'http=200', 'local owner header is dropped'),
        'plan:GET,/internal/agent-egress/policy,x-api-key=$ALPHA_KEY': (False, 'http=403', 'control plane'),
        'plan:GET,/auth/verify,x-api-key=$ALPHA_KEY': (False, 'http=403', 'reverse-proxy check'),
    }
    specs = list(checks)
    initialize = json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {
        'protocolVersion': '2024-11-05', 'capabilities': {}, 'clientInfo': {'name': 'proof', 'version': '1'}}})
    # Raw requests: a body that carries a second request, and ambiguous framing.
    smuggle_body = f'GET /projects HTTP/1.1\r\nHost: x\r\nx-api-key: {k["betaKey"]}\r\n\r\n'
    raw = {
        'mcp alpha': (f'POST /mcp HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer {k["alphaKey"]}\r\n'
                      f'Content-Type: application/json\r\nAccept: application/json, text/event-stream\r\n'
                      f'Content-Length: {len(initialize)}\r\n\r\n{initialize}', ' 200 '),
        'mcp beta': (f'POST /mcp HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer {k["betaKey"]}\r\n'
                     f'Content-Type: application/json\r\nAccept: application/json, text/event-stream\r\n'
                     f'Content-Length: {len(initialize)}\r\n\r\n{initialize}', ' 403 '),
        'body carrying a request': (f'GET /me HTTP/1.1\r\nHost: x\r\nx-api-key: {k["alphaKey"]}\r\n'
                                    f'Content-Length: {len(smuggle_body)}\r\n\r\n{smuggle_body}', ' 200 '),
        'Content-Length and Transfer-Encoding': (
            f'GET /me HTTP/1.1\r\nHost: x\r\nx-api-key: {k["alphaKey"]}\r\nContent-Length: 4\r\n'
            'Transfer-Encoding: chunked\r\n\r\n0\r\n\r\n', ' 400 '),
        'folded header': (f'GET /me HTTP/1.1\r\nHost: x\r\nx-api-key: {k["alphaKey"]}\r\n x: y\r\n\r\n', ' 400 '),
        'absolute target': (f'GET http://127.0.0.1:8443/ HTTP/1.1\r\nHost: x\r\n\r\n', ' 400 '),
    }
    raw_specs = {f'raw:127.0.0.1,3000,{hexed(request)}': (name, want) for name, (request, want) in raw.items()}
    results = probe('alpha', 'alpha', specs + list(raw_specs), env=env)
    for spec, (want_ok, contains, label) in checks.items():
        expect(report, 'P', results, spec, want_ok, contains, label)
    for spec, (name, want) in raw_specs.items():
        value = results.get(spec, {'detail': results.get('_error', 'missing')})
        report.add('P', f'raw: {name}', want in f' {value["detail"]} ', value['detail'])
    _ = mcp
    results = probe('home', 'home', ['plan:GET,/projects,x-api-key=$HOME_KEY', 'plan:GET,/projects,x-api-key=$ALPHA_KEY'],
                    env=env)
    expect(report, 'P', results, 'plan:GET,/projects,x-api-key=$HOME_KEY', True, 'http=200', 'Home unit, Home key')
    expect(report, 'P', results, 'plan:GET,/projects,x-api-key=$ALPHA_KEY', False, 'http=403', 'Home unit, project key')


# ── Network modes ────────────────────────────────────────────────────────────────────────


def run_mode_proofs(report, probe, keys, state) -> None:
    k = keys()
    owner = k['ownerKey']
    alpha = k['alphaAgentId']
    settings = '/projects/ALPHA/settings/agent-network'

    def configure(body: dict) -> None:
        status, answer = api(state, 'PUT', settings, owner, body)
        if status != 200:
            raise RuntimeError(f'settings refused: {status} {answer}')
        time.sleep(5)  # the proxy reads the policies every 2 seconds in the test

    connect = lambda host, port: f'raw:127.0.0.1,3128,{hexed(f"CONNECT {host}:{port} HTTP/1.1{chr(13)}{chr(10)}Host: {host}:{port}{chr(13)}{chr(10)}{chr(13)}{chr(10)}")}'  # noqa: E731
    try:
        configure({'mode': 'blocked', 'allow': [], 'deny': [], 'mailPorts': False, 'agents': {str(alpha): None}})
        results = probe('alpha', 'alpha', ['curl:https://example.com', 'curl:http://example.com/'])
        expect(report, 'M', results, 'curl:https://example.com', False, 'http=403', 'blocked: https refused')
        expect(report, 'M', results, 'curl:http://example.com/', False, 'http=403', 'blocked: http refused')

        configure({'mode': 'allowlist', 'allow': ['example.com'], 'deny': []})
        results = probe('alpha', 'alpha', ['curl:https://example.com', 'curl:https://www.example.com',
                                           'curl:https://example.org'])
        expect(report, 'M', results, 'curl:https://example.com', True, 'http=200', 'allowlist: listed domain')
        expect(report, 'M', results, 'curl:https://www.example.com', True, 'http=', 'allowlist: its subdomain')
        expect(report, 'M', results, 'curl:https://example.org', False, 'http=403', 'allowlist: other domain')

        configure({'mode': 'open', 'allow': [], 'deny': ['example.org']})
        results = probe('alpha', 'alpha', ['curl:https://example.com', 'curl:https://example.org',
                                           connect('smtp.gmail.com', 587)])
        expect(report, 'M', results, 'curl:https://example.com', True, 'http=200', 'open: public host')
        expect(report, 'M', results, 'curl:https://example.org', False, 'http=403', 'open: denied domain')
        expect(report, 'M', results, connect('smtp.gmail.com', 587), True, ' 403 ', 'open: mail port closed')

        configure({'mailPorts': True})
        results = probe('alpha', 'alpha', [connect('smtp.gmail.com', 587)])
        expect(report, 'M', results, connect('smtp.gmail.com', 587), True, ' 200 ', 'mail role: port 587 open')

        # One agent blocked while the project stays open: the unit of that agent is refused,
        # a unit of the same project without it is not.
        configure({'mailPorts': False, 'agents': {str(alpha): 'blocked'}})
        results = probe('alpha', 'alpha', ['curl:https://example.com'], agent_id=alpha, work=('run', 1))
        expect(report, 'M', results, 'curl:https://example.com', False, 'http=403', 'per agent: blocked agent')
        results = probe('alpha', 'alpha', ['curl:https://example.com'])
        expect(report, 'M', results, 'curl:https://example.com', True, 'http=200', 'per agent: rest of the project')
        configure({'agents': {str(alpha): 'allowlist'}, 'allow': ['example.net']})
        results = probe('alpha', 'alpha', ['curl:https://example.net', 'curl:https://example.com'], agent_id=alpha)
        expect(report, 'M', results, 'curl:https://example.net', True, 'http=', 'per agent: allowlist agent, listed')
        expect(report, 'M', results, 'curl:https://example.com', False, 'http=403', 'per agent: allowlist agent, other')

        time.sleep(5)  # the proxy reports every 2 seconds in the test
        status, page = api(state, 'GET', '/projects/ALPHA/agent-network/events?limit=200', owner)
        items = page.get('items', []) if isinstance(page, dict) else []
        reasons = {item['reason'] for item in items if item['decision'] == 'blocked'}
        report.add('M', 'log: refusals reach Plan with their reason',
                   status == 200 and {'blocked', 'not-allowlisted', 'denylisted', 'port'} <= reasons,
                   f'status={status} reasons={sorted(r for r in reasons if r)}')
        allowed = [item for item in items if item['decision'] == 'allowed' and item['host'] == 'example.com']
        report.add('M', 'log: allowed connections with bytes',
                   bool(allowed) and any(item['bytesIn'] > 0 for item in allowed),
                   json.dumps(allowed[:1])[:200])
        tagged = [item for item in items if (item.get('agent') or {}).get('id') == alpha]
        report.add('M', 'log: the agent of the unit is named', bool(tagged), f'{len(tagged)} entries for agent {alpha}')
    finally:
        api(state, 'PUT', settings, owner, {'mode': 'open', 'allow': [], 'deny': [], 'mailPorts': False,
                                            'agents': {str(alpha): None}})


# ── Function (design §6.5) ───────────────────────────────────────────────────────────────


def run_function_proofs(report, probe, client, keys, state) -> None:
    report.add('5', 'pending', False, 'not written yet')


# ── Terminal ─────────────────────────────────────────────────────────────────────────────


def run_terminal_proofs(report, sh, iso, socket, root) -> None:
    report.add('T', 'pending', False, 'not written yet')
