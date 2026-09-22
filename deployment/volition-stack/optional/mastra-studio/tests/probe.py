#!/usr/bin/env python3
"""Safe smoke and boundary checks against the loopback control-plane proxy."""
import argparse
import http.client
import json
from urllib.parse import urlsplit

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://172.30.95.2:4111')
parser.add_argument('--owner', default='owner@example.com')
args = parser.parse_args()
url = urlsplit(args.url)
assert url.hostname in ('127.0.0.1', 'localhost', '172.30.95.2'), 'Administrative probes must use loopback or the isolated Studio bridge'
trusted = {'x-volition-auth': 'verified', 'x-auth-request-email': args.owner}
checks = []

def request(path, method='GET', headers=None, expected=200):
    connection = http.client.HTTPConnection(url.hostname, url.port, timeout=10)
    connection.request(method, path, headers=headers or {})
    response = connection.getresponse()
    body = response.read()
    assert response.status == expected, (method, path, response.status, body[:200])
    checks.append({'method': method, 'path': path, 'status': response.status})
    connection.close()
    return body

request('/healthz')
request('/mastra/workflows', expected=403)
request('/mastra/workflows', headers={**trusted, 'x-auth-request-email': 'not-the-owner@example.org'}, expected=403)
workflows = json.loads(request('/mastra/api/workflows', headers=trusted))
expected = {'inbox-triage', 'career-research', 'application', 'support', 'system-audit', 'document-filing'}
assert set(workflows) == expected, list(workflows)
for identifier in workflows:
    details = json.loads(request('/mastra/api/workflows/' + identifier, headers=trusted))
    assert len(details['steps']) == 2
    runs = json.loads(request('/mastra/api/workflows/' + identifier + '/runs', headers=trusted))
    assert not runs.get('runs'), runs
    request('/mastra/workflows/' + identifier + '/graph', headers=trusted)
for method in ('PUT', 'PATCH', 'DELETE', 'OPTIONS'):
    request('/mastra/api/workflows/inbox-triage/create-run', method, trusted, expected=405)
request('/mastra/api/workflows/inbox-triage/start', headers=trusted, expected=403)
request('/mastra/api/stored/agents', headers=trusted, expected=403)
request('/mastra/api/workflows/missing', headers=trusted, expected=403)
request('/mastra/api/auth/sso/login', headers=trusted, expected=403)
for path in ('/mastra/%2e%2e/backend', '/mastra/../backend', '//mastra/workflows', '/mastra/api%2fworkflows'):
    request(path, headers=trusted, expected=400)
request('/backend', headers=trusted, expected=404)
page = request('/mastra/workflows', headers=trusted).decode()
assert 'Control Plane' in page and 'Sicherer Dry-Run' in page
assert 'refresh-events' not in page
assert "window.MASTRA_AUTO_DETECT_URL = 'true'" in page
request('/mastra/catalog', headers=trusted)
request('/mastra/workflows', 'HEAD', trusted)
print(json.dumps({'result': 'passed', 'checks': len(checks), 'workflows': len(workflows), 'production_mutations': 0, 'details': checks}, indent=2))
