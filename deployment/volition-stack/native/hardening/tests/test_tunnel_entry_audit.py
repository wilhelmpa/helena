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

    def test_public_worker_exemption_is_exact_and_credential_free(self):
        variants = (
            TEMPLATE.replace('location = /sw.js', 'location /sw.js'),
            TEMPLATE.replace('location = /sw.js', 'location = /other.js'),
            TEMPLATE.replace('proxy_pass http://127.0.0.1:3001/sw.js;',
                             'proxy_pass http://127.0.0.1:3000/backend/;'),
            TEMPLATE.replace('proxy_set_header Cookie "";', 'proxy_set_header Cookie $http_cookie;', 1),
            TEMPLATE.replace('proxy_set_header Authorization "";',
                             'proxy_set_header Authorization $http_authorization;', 1),
            TEMPLATE.replace('proxy_set_header X-Helena-Entry "";',
                             'proxy_set_header X-Helena-Entry internal;', 1),
            TEMPLATE.replace('location = /sw.js {',
                             'location = /sw.js { rewrite ^ /backend/ break;'),
        )
        for config in variants:
            with self.subTest(config=config):
                report = self.audit(config)
                self.assertIn('web.tunnel_entry|fail|', report)
                self.assertIn('1 location(s) without the tunnel headers', report)

    def test_each_public_asset_exemption_is_exact_and_credential_free(self):
        blocks = []
        for selector in ('= /sw.js', '= /manifest.webmanifest', '~ ^/voice/',
                         '~ ^/code/stable-', '~ ^/code/(stable-'):
            start = TEMPLATE.index('    location ' + selector)
            end = TEMPLATE.index('\n    }', start) + len('\n    }')
            blocks.append(TEMPLATE[start:end])
        for block in blocks:
            variants = [
                block.replace('auth_request off;', ''),
                block.replace('proxy_set_header Cookie "";', 'proxy_set_header Cookie $http_cookie;'),
                block.replace('proxy_set_header Authorization "";',
                              'proxy_set_header Authorization $http_authorization;'),
                block.replace('proxy_set_header X-Helena-Entry "";',
                              'proxy_set_header X-Helena-Entry internal;'),
                block.replace('127.0.0.1:3001', '127.0.0.1:3000').replace('127.0.0.1:8443', '127.0.0.1:8444'),
                block.replace('    }', '        rewrite ^ /backend/ break;\n    }'),
                block.replace('location ', 'location /private-assets/ # ', 1),
            ]
            for changed in variants:
                with self.subTest(location=block.splitlines()[0], changed=changed):
                    report = self.audit(TEMPLATE.replace(block, changed))
                    self.assertIn('web.tunnel_entry|fail|', report)
                    self.assertIn('1 location(s) without the tunnel headers', report)

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
