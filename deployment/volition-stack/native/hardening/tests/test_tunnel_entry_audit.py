"""Exercise the actual tunnel audit block against offline nginx fixtures."""

import os
from pathlib import Path
import subprocess
import tempfile
import unittest


HARDENING = Path(__file__).resolve().parents[1]
AUDIT = (HARDENING / 'audit.sh').read_text()
CHECK = AUDIT[AUDIT.index('if [[ -e $NGINX_TUNNEL_SITE ]]; then'):AUDIT.index('\napi_env=')]
TEMPLATE = (HARDENING.parent / 'cloudflare/nginx-tunnel.conf.in').read_text()
TEMPLATE = TEMPLATE.replace('@PORT@', '8090').replace('@HOST@', 'helena.example.test')
LOCATION = 'location ~ ^/(backend/|api/)?owner-terminal/local/'
DENY = LOCATION + ' {\n        return 404;\n    }'
HEADERS = 'include /etc/nginx/snippets/helena-tunnel-headers.conf;'


class TunnelEntryAuditTests(unittest.TestCase):
    def audit(self, config):
        with tempfile.TemporaryDirectory(prefix='helena-tunnel-audit-') as folder:
            site = Path(folder) / 'tunnel.conf'
            site.write_text(config)
            result = subprocess.run(
                ['bash', '-c', 'set -uo pipefail\nrecord() { printf "%s|%s|%s\\n" "$1" "$4" "$5"; }\n' + CHECK],
                env={**os.environ, 'NGINX_TUNNEL_SITE': str(site), 'TUNNEL_PORT': '8090'},
                capture_output=True, text=True, timeout=5,
            )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, '')
        return result.stdout.strip()

    def test_exact_deny_passes_for_rendered_template_and_inline_format(self):
        for block in (DENY, LOCATION + ' { return 404; }'):
            with self.subTest(block=block):
                self.assertIn('web.tunnel_entry|pass|', self.audit(TEMPLATE.replace(DENY, block)))

    def test_proxy_conditional_and_additional_directives_are_not_exempt(self):
        bodies = (
            'proxy_pass http://127.0.0.1:3000;',
            'if ($arg_deny) { return 404; } proxy_pass http://127.0.0.1:3000;',
            'return 404; proxy_pass http://127.0.0.1:3000;',
            'rewrite ^ /backend/ break; return 404;',
            'error_page 404 = /backend/; return 404;',
            'return 403;',
        )
        for body in bodies:
            with self.subTest(body=body):
                report = self.audit(TEMPLATE.replace(DENY, LOCATION + ' { ' + body + ' }'))
                self.assertIn('web.tunnel_entry|fail|', report)
                self.assertIn('1 location(s) without the tunnel headers', report)

    def test_unrelated_deny_has_no_blanket_exemption(self):
        self.assertIn('web.tunnel_entry|fail|', self.audit(TEMPLATE.replace(LOCATION, 'location /other/')))

    def test_error_page_mapping_keeps_the_deny_under_the_header_check(self):
        for separator in (' ', '\n    '):
            with self.subTest(separator=separator):
                config = TEMPLATE.replace('server_name helena.example.test;',
                                          'server_name helena.example.test;' + separator + 'error_page 404 = /backend/;')
                self.assertIn('web.tunnel_entry|fail|', self.audit(config))

    def test_valid_deny_does_not_hide_an_unprotected_proxy(self):
        report = self.audit(TEMPLATE.replace(HEADERS, '', 1))
        self.assertIn('web.tunnel_entry|fail|', report)
        self.assertIn('1 location(s) without the tunnel headers', report)

    def test_listener_owner_token_and_edge_guards_still_fail(self):
        variants = (
            TEMPLATE.replace('listen 127.0.0.1:8090;', 'listen 8090;'),
            TEMPLATE + '\nproxy_set_header X-Test $helena_owner_capability;\n',
            TEMPLATE.replace('auth_request /_helena_edge;', 'auth_request off;'),
        )
        for name, config in zip(('listener', 'owner token', 'edge auth'), variants):
            with self.subTest(name=name):
                self.assertIn('web.tunnel_entry|fail|', self.audit(config))


if __name__ == '__main__':
    unittest.main()
