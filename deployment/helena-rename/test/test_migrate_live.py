"""Tests of migrate_live.py.

The rule tests need nothing. The end-to-end tests build a sandbox root that looks like the live
install (units, nginx, sudoers, env files, Hermes profiles, git worktrees, a web release link),
run the migration against it with stub commands (systemctl, usermod, groupmod, pgrep) and a real
Postgres, and then roll it back. They run when HELENA_RENAME_TEST_PG names a private test
cluster, e.g.

    HELENA_RENAME_TEST_PG="-h 127.0.0.1 -p 55495 -U wilhelmpa" \\
      python3 -m unittest discover -s deployment/helena-rename/test -v

They refuse the default port 5432, so they never touch a live cluster.
"""

import copy
import hashlib
import json
import os
import shlex
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
KIT = os.path.dirname(HERE)
sys.path.insert(0, KIT)

import migrate_live  # noqa: E402

MAP_PATH = os.path.join(KIT, "rename-map.json")
PG = os.environ.get("HELENA_RENAME_TEST_PG", "")


def load_map():
    with open(MAP_PATH, encoding="utf-8") as handle:
        return json.load(handle)


class RulesTest(unittest.TestCase):
    def setUp(self):
        self.map = load_map()

    def rewrite(self, kind, text):
        return migrate_live.Rules(self.map, kind).rewrite(text)[0]

    def test_unit_names_and_paths(self):
        text = (
            "ExecStart=/usr/local/bin/bun run /srv/volition/source/plan/apps/api/src/index.ts\n"
            "After=volition-plan-migrate.service volition-hermes-runner.service\n"
            "EnvironmentFile=/etc/volition/plan.env\n"
            "ReadWritePaths=/var/lib/volition/plan /srv/volition/vault\n"
            "Group=volition\nSupplementaryGroups=volition-private\n"
            "Description=Volition Plan API\n"
        )
        out = self.rewrite("config", text)
        self.assertIn("/srv/helena/source/helena/apps/api", out)
        self.assertIn("After=helena-migrate.service helena-runner.service", out)
        self.assertIn("EnvironmentFile=/etc/helena/helena.env", out)
        self.assertIn("ReadWritePaths=/var/lib/helena/app /srv/helena/vault", out)
        self.assertIn("Group=helena\n", out)
        self.assertIn("SupplementaryGroups=helena-private", out)
        self.assertIn("Description=Helena API", out)
        self.assertNotIn("volition", out.lower())

    def test_whole_tokens_only(self):
        out = self.rewrite("config", "/srv/volition/source/plan-orchestration/x and volition-plan-foo")
        self.assertEqual(out, "/srv/helena/source/helena-orchestration/x and helena-plan-foo")
        # A domain, a mail address and a foreign path keep their spelling.
        kept = "server_name plan.volition.one; patrick@volition.one; /opt/volition/x; volition_other"
        self.assertEqual(self.rewrite("config", kept), kept)

    def test_words_only_in_config(self):
        self.assertEqual(self.rewrite("data", 'folder id="volition"'), 'folder id="volition"')
        self.assertEqual(self.rewrite("config", "Group=volition"), "Group=helena")

    def test_env_file(self):
        text = (
            "DATABASE_URL=postgres://itsaplan:p%40ss@127.0.0.1:5432/itsaplan\n"
            "export PLAN_CONTROL_TOKEN_FILE=/etc/volition/plan-control.token\n"
            "VOLITION_VAULT_ROOT=/srv/volition/vault\n"
            "ITSAPLAN_MCP_BEARER_FILE=/etc/volition/hermes-plan-key\n"
            "ITSAPLAN_CONCURRENCY=3\n"
            "PLAN_SECRET_ALLOW_HOST=plan-api.volition.one\n"
            "BETTER_AUTH_SECRET=volition-plan-looks-like-a-name\n"
        )
        out = self.rewrite("env", text)
        self.assertIn("DATABASE_URL=postgres://helena:p%40ss@127.0.0.1:5432/helena\n", out)
        self.assertIn("export HELENA_CONTROL_TOKEN_FILE=/etc/helena/control.token\n", out)
        self.assertIn("HELENA_VAULT_ROOT=/srv/helena/vault\n", out)
        self.assertIn("HELENA_MCP_BEARER_FILE=/etc/helena/runner-api.key\n", out)
        self.assertIn("HELENA_CONCURRENCY=3\n", out)
        self.assertIn("# retired by helena-rename: PLAN_SECRET_ALLOW_HOST=", out)

    def test_postgres_url_other_database_untouched(self):
        text = "X=postgres://someone@db:5432/other\n"
        self.assertEqual(self.rewrite("env", text), text)

    def test_hermes_config(self):
        text = (
            "mcp_servers:\n  itsaplan:\n    url: http://127.0.0.1:3000/mcp\n"
            "    headers:\n      Authorization: Bearer ${ITSAPLAN_API_KEY}\n"
            "plugins:\n  enabled:\n    - plan-approval-guard\n"
            "managed: /var/lib/volition/hermes/profiles/vol/run/itsaplan-managed\n"
        )
        out = self.rewrite("hermes", text)
        self.assertIn("  helena:\n", out)
        self.assertIn("Bearer ${HELENA_API_KEY}", out)
        self.assertIn("- helena-approval-guard", out)
        self.assertIn("/var/lib/helena/hermes/profiles/vol/run/helena-managed", out)
        # Outside Hermes files the bare word stays.
        self.assertIn("itsaplan:", self.rewrite("data", text))

    def test_local_owner_header(self):
        text = "proxy_set_header X-Volition-Local-Access $volition_local_owner_token;"
        self.assertEqual(
            self.rewrite("config", text),
            "proxy_set_header X-Helena-Local-Access $helena_local_owner_token;",
        )

    def test_unit_name_mapping(self):
        args = type("A", (), {})()
        args.root, args.map, args.backup_dir, args.pg_connect, args.dry_run = "/nonexistent-root", MAP_PATH, "/b", None, True
        migration = migrate_live.Migration(args)
        self.assertEqual(migration.new_unit_name("volition-plan-api.service"), "helena-api.service")
        self.assertEqual(migration.new_unit_name("volition-project-browser@vol.target"), "helena-browser@vol.target")
        self.assertEqual(
            migration.new_unit_name("volition-project-browser-chromium@fam.service"),
            "helena-browser-chromium@fam.service",
        )
        self.assertIsNone(migration.new_unit_name("volition-hermes-gateway.service"))
        self.assertIsNone(migration.new_unit_name("volition-project-browser-xvfb@vol.service"))
        self.assertEqual(migration.new_unit_name("volition-something-new.service"), "helena-something-new.service")


# ---------------------------------------------------------------------------------------
# End to end
# ---------------------------------------------------------------------------------------

UNITS = {
    "volition-plan-api.service": {"file": "enabled", "active": "active"},
    "volition-plan-web.service": {"file": "enabled", "active": "active"},
    "volition-plan-worker.service": {"file": "enabled", "active": "active"},
    "volition-plan-migrate.service": {"file": "static", "active": "inactive"},
    "volition-plan-api-dev.service": {"file": "masked", "active": "inactive"},
    "volition-hermes-runner.service": {"file": "enabled", "active": "active"},
    "volition-hermes-gateway.service": {"file": "disabled", "active": "inactive"},
    "volition-hermes-bootstrap.timer": {"file": "enabled", "active": "active"},
    "volition-hermes-bootstrap.service": {"file": "static", "active": "inactive"},
    "volition-project-browser@.target": {"file": "static", "active": "inactive"},
    "volition-project-browser@vol.target": {"file": "transient", "active": "active"},
    "volition-project-browser-chromium@vol.service": {"file": "transient", "active": "active"},
    "volition-project-browser-chromium@.service": {"file": "static", "active": "inactive"},
    "nginx.service": {"file": "enabled", "active": "active"},
}

FILES = {
    "etc/passwd": (
        "root:x:0:0:root:/root:/bin/bash\n"
        "wilhelmpa:x:1000:1000::/home/wilhelmpa:/bin/bash\n"
        "postgres:x:105:110::/var/lib/postgresql:/bin/bash\n"
        "volition-plan:x:999:990::/var/lib/volition/plan:/usr/sbin/nologin\n"
        "volition-hermes:x:996:990::/var/lib/volition/hermes:/usr/sbin/nologin\n"
        "volition-google:x:986:983::/var/lib/volition-google:/usr/sbin/nologin\n"
    ),
    "etc/group": (
        "root:x:0:\nwilhelmpa:x:1000:\nvolition:x:990:wilhelmpa,volition-sync\n"
        "volition-plan-secrets:x:989:volition-plan\nvolition-private:x:1001:volition-plan,wilhelmpa\n"
        "volition-google:x:983:\n"
    ),
    "etc/volition/plan.env": (
        "DATABASE_URL=postgres://itsaplan_rt:secretpw@127.0.0.1:5432/itsaplan_rt\n"
        "BETTER_AUTH_SECRET=do-not-change-me\n"
        "PLAN_CONTROL_TOKEN_FILE=/etc/volition/plan-control.token\n"
        "VOLITION_VAULT_ROOT=/srv/volition/vault\n"
        "PLAN_SECRET_ALLOW_HOST=plan-api.volition.one\n"
    ),
    "etc/volition/plan-control.token": "0123456789abcdef0123456789abcdef\n",
    "etc/volition/hermes-plan-key": "itp_secret_key_value\n",
    "etc/volition/local-owner.env": "LOCAL_SINGLE_USER_EMAIL=owner@example.org\n",
    "etc/volition/runner/itsaplan-runner.json": '{"url": "http://127.0.0.1:3000", "cwd": "/srv/volition/workspaces"}\n',
    "etc/volition/runner/itsaplan-runner.json.bak-20260923-yolo": '{"cwd": "/srv/volition/workspaces"}\n',
    "etc/systemd/system/volition-plan-api.service": (
        "[Unit]\nDescription=Volition Plan API\nAfter=postgresql.service volition-plan-migrate.service\n"
        "[Service]\nUser=volition-plan\nGroup=volition\nSupplementaryGroups=volition-private\n"
        "WorkingDirectory=/srv/volition/source/plan\nEnvironmentFile=/etc/volition/plan.env\n"
        "LoadCredential=plan_control_token:/etc/volition/plan-control.token\n"
        "ExecStart=/usr/local/bin/bun --env-file=/etc/volition/plan.env run apps/api/src/index.ts\n"
        "[Install]\nWantedBy=multi-user.target\n"
    ),
    "etc/systemd/system/volition-plan-api.service.d/50-local-owner.conf": (
        "[Service]\nEnvironmentFile=/etc/volition/local-owner.env\n"
    ),
    "etc/systemd/system/volition-plan-web.service": "[Service]\nUser=volition-plan\nWorkingDirectory=/srv/volition/releases/web/current/apps/web\n",
    "etc/systemd/system/volition-plan-worker.service": "[Service]\nUser=volition-plan\n",
    "etc/systemd/system/volition-plan-migrate.service": "[Service]\nType=oneshot\nUser=volition-plan\n",
    "etc/systemd/system/volition-hermes-runner.service": (
        "[Service]\nUser=volition-hermes\nGroup=volition-hermes-secrets\n"
        "LoadCredential=itsaplan_api_key:/etc/volition/hermes-plan-key\n"
        "ExecStart=/usr/local/libexec/volition-hermes-runner\n"
    ),
    "etc/systemd/system/volition-hermes-gateway.service": "[Service]\nExecStart=/bin/true\n",
    "etc/systemd/system/volition-hermes-bootstrap.service": "[Service]\nExecStart=/usr/local/libexec/volition-hermes-bootstrap\n",
    "etc/systemd/system/volition-hermes-bootstrap.timer": "[Timer]\nOnUnitActiveSec=30\n",
    "etc/systemd/system/volition-project-browser@.target": "[Unit]\nWants=volition-project-browser-chromium@%i.service\n",
    "etc/systemd/system/volition-project-browser-chromium@.service": (
        "[Service]\nEnvironmentFile=/var/lib/volition/project-browser/projects/%i/runtime.env\n"
    ),
    "etc/systemd/system/nginx.service.d/volition-stale-socket.conf": "[Service]\nExecStartPre=-/bin/rm -f /srv/volition/dev-run/plan-dev.sock\n",
    "etc/systemd/system/getty@tty1.service.d/autologin.conf": "[Service]\nExecStart=-/sbin/agetty --autologin kiosk\n# /usr/local/libexec/volition-plan-kiosk\n",
    "etc/nginx/sites-available/volition.conf": (
        "server {\n    server_name kingston-server.local;\n    # docs: https://plan.volition.one\n"
        "    location / {\n        proxy_set_header X-Volition-Local-Access $volition_local_owner_token;\n"
        "        proxy_pass http://127.0.0.1:3001;\n    }\n"
        "    include /etc/nginx/snippets/volition-owner-terminal.conf;\n}\n"
    ),
    "etc/nginx/conf.d/volition-local-owner.conf": "geo $volition_local_owner_source {\n    default 0;\n}\n",
    "etc/nginx/snippets/volition-owner-terminal.conf": "location /owner-terminal/ { proxy_pass http://unix:/run/volition-owner-terminal/term.sock; }\n",
    "etc/nginx/volition.conf.bak-owner-terminal": "old backup /srv/volition\n",
    "etc/sudoers.d/91-volition-gog": "wilhelmpa ALL=(volition-google) NOPASSWD: /usr/local/libexec/volition-gog-bridge\n",
    "etc/polkit-1/rules.d/60-volition-project-browser.rules": (
        'polkit.addRule(function(action, subject) { if (subject.user == "volition-hermes" && '
        'action.lookup("unit").indexOf("volition-project-browser") == 0) return polkit.Result.YES; });\n'
    ),
    "usr/local/libexec/volition-hermes-runner": (
        "#!/bin/sh\ncredential_file=\"$CREDENTIALS_DIRECTORY/itsaplan_api_key\"\n"
        "template_file=/etc/volition/runner/itsaplan-runner.json\n"
        "runtime_file=/var/lib/volition/hermes/run/itsaplan-runner.json\n"
        "exec /usr/bin/node /srv/volition/source/plan/packages/runner/dist/cli.js \"$runtime_file\"\n"
    ),
    "usr/local/libexec/volition-gog-bridge": "#!/bin/sh\nexec /usr/local/libexec/volition-gog \"$@\"\n",
    "var/lib/volition/plan/storage/blob": "binary-ish content\n",
    "var/lib/volition/deploy/deployed": "0000000\n",
    "var/lib/volition/hermes/config.yaml": (
        "mcp_servers:\n  itsaplan:\n    url: http://127.0.0.1:3000/mcp\n    headers:\n"
        "      Authorization: Bearer ${ITSAPLAN_API_KEY}\nplugins:\n  enabled:\n    - plan-approval-guard\n"
    ),
    "var/lib/volition/hermes/run/itsaplan-runner.json": '{"cwd": "/srv/volition/workspaces"}\n',
    "var/lib/volition/hermes/run/itsaplan-policy-manifest.json": "{}\n",
    "var/lib/volition/hermes/run/itsaplan-managed/config.yaml": "x: 1\n",
    "var/lib/volition/hermes/run/agents/vol.json": (
        '{"apiKey": "itp_agent_secret", "cwd": "/srv/volition/workspaces/projects/vol", '
        '"hermesHome": "/var/lib/volition/hermes/profiles/vol"}\n'
    ),
    "var/lib/volition/hermes/profiles/vol/config.yaml": "model: luna\nworkdir: /srv/volition/workspaces/projects/vol\n",
    "var/lib/volition/hermes/profiles/vol/run/itsaplan-managed/SOUL.md": "soul\n",
    "var/lib/volition/hermes/profiles/vol/run/itsaplan-policy-manifest.json": "{}\n",
    "var/lib/volition/hermes/venv/bin/pip": "#!/var/lib/volition/hermes/venv/bin/python\nimport pip\n",
    "var/lib/volition/project-browser/projects/vol/runtime.env": (
        "PROJECT_BROWSER_PROFILE=/var/lib/volition/project-browser/projects/vol/profile\n"
    ),
    "var/lib/volition/syncthing/config.xml": '<folder id="volition" label="Volition" path="/srv/volition/vault"></folder>\n',
    "var/lib/volition-google/gog/state": "x\n",
    "srv/volition/vault/Home/note.md": "# Note\n",
    "srv/volition/workspaces/projects/vol/README.md": "vol\n",
    "srv/volition/releases/web/20260924-003420-e5ad5546/apps/web/server.js": "// web\n",
    "home/wilhelmpa/.local/bin/gog": "#!/bin/sh\nexec sudo -u volition-google /usr/local/libexec/volition-gog-bridge \"$@\"\n",
}

SYMLINKS = {
    "etc/nginx/sites-enabled/volition.conf": "../sites-available/volition.conf",
    "etc/systemd/system/volition-plan-api-dev.service": "/dev/null",
    "etc/systemd/system/multi-user.target.wants/volition-plan-api.service": "/etc/systemd/system/volition-plan-api.service",
    "srv/volition/releases/web/current": "/srv/volition/releases/web/20260924-003420-e5ad5546",
    "var/lib/volition/hermes/venv/bin/python": "/usr/bin/python3",
}


def git(repo, *args, env=None):
    return subprocess.run(
        ["git", "-C", repo] + list(args), check=True, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env
    ).stdout.strip()


SKIP = ("var/backups", "calls.log", "systemd.json", "systemd.json.calls", "srv/volition/source")


def tree_digest(root, skip=SKIP):
    """Names, link targets and contents below root, apart from the skipped paths."""
    digest = hashlib.sha256()
    for directory, dirs, files in os.walk(root):
        rel_dir = os.path.relpath(directory, root)
        if rel_dir != "." and any(rel_dir == s or rel_dir.startswith(s + os.sep) for s in skip):
            dirs[:] = []
            continue
        dirs.sort()
        entries = sorted(files + [d for d in dirs if os.path.islink(os.path.join(directory, d))])
        digest.update(("D " + rel_dir + "\n").encode())
        for name in entries:
            path = os.path.join(directory, name)
            rel = os.path.normpath(os.path.join(rel_dir, name))
            if rel in skip:
                continue
            digest.update(rel.encode())
            if os.path.islink(path):
                digest.update(b"->" + os.readlink(path).encode())
            elif os.path.isfile(path):
                with open(path, "rb") as handle:
                    digest.update(handle.read())
    return digest.hexdigest()


@unittest.skipUnless(PG, "set HELENA_RENAME_TEST_PG to a private test cluster")
class EndToEndTest(unittest.TestCase):
    def setUp(self):
        if "5432" in PG.split():
            self.skipTest("refusing the default port 5432")
        base = os.environ.get("TMPDIR")
        self.work = tempfile.mkdtemp(prefix="helena-rename-", dir=base)
        self.root = os.path.join(self.work, "root")
        os.makedirs(self.root)
        self.systemd = os.path.join(self.root, "systemd.json")
        with open(self.systemd, "w", encoding="utf-8") as handle:
            json.dump({"units": copy.deepcopy(UNITS)}, handle)
        for rel, content in FILES.items():
            path = os.path.join(self.root, rel)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w", encoding="utf-8") as handle:
                handle.write(content)
        for rel, target in SYMLINKS.items():
            path = os.path.join(self.root, rel)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            os.symlink(target, path)
        self._git_fixture()
        self._pg_fixture()
        self.map_path = self._test_map()
        self.env = dict(os.environ)
        self.env["PATH"] = os.path.join(HERE, "stubs") + os.pathsep + self.env["PATH"]
        self.env["HELENA_RENAME_TEST_ROOT"] = self.root
        self.env["HELENA_RENAME_TEST_SYSTEMD"] = self.systemd
        for stub in os.listdir(os.path.join(HERE, "stubs")):
            os.chmod(os.path.join(HERE, "stubs", stub), 0o755)

    def tearDown(self):
        for db in ("itsaplan_rt", "helena_rt", "itsaplan_rt_dev", "helena_rt_dev"):
            self.psql("postgres", 'DROP DATABASE IF EXISTS "%s"' % db, check=False)
        for role in ("itsaplan_rt", "helena_rt"):
            self.psql("postgres", 'DROP ROLE IF EXISTS "%s"' % role, check=False)
        shutil.rmtree(self.work, ignore_errors=True)

    # fixtures ------------------------------------------------------------------------

    def psql(self, database, sql, check=True):
        return subprocess.run(
            ["psql"] + shlex.split(PG) + ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-d", database, "-c", sql],
            check=check,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        ).stdout.strip()

    def _pg_fixture(self):
        for db in ("itsaplan_rt", "helena_rt", "itsaplan_rt_dev", "helena_rt_dev"):
            self.psql("postgres", 'DROP DATABASE IF EXISTS "%s"' % db)
        for role in ("itsaplan_rt", "helena_rt"):
            self.psql("postgres", 'DROP ROLE IF EXISTS "%s"' % role)
        self.psql("postgres", "CREATE ROLE itsaplan_rt LOGIN PASSWORD 'secretpw'")
        self.psql("postgres", "CREATE DATABASE itsaplan_rt OWNER itsaplan_rt")
        self.psql("postgres", "CREATE DATABASE itsaplan_rt_dev OWNER itsaplan_rt")
        self.psql(
            "itsaplan_rt",
            "CREATE SCHEMA drizzle; CREATE TABLE drizzle.__drizzle_migrations (id serial, hash text, created_at bigint);"
            "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('a', 1000);"
            "CREATE TABLE ai_agent (id int, runtime_policy jsonb);"
            "INSERT INTO ai_agent VALUES (1, '{\"mcpGrants\": [\"itsaplan\", \"browser\"]}');",
        )

    def _git_fixture(self):
        env = dict(os.environ, GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@example.org",
                   GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@example.org")
        self.git_env = env
        live = os.path.join(self.root, "srv/volition/source/plan")
        os.makedirs(live)
        subprocess.run(["git", "init", "-q", "-b", "volition/native", live], check=True)
        with open(os.path.join(live, "README.md"), "w") as handle:
            handle.write("old\n")
        git(live, "add", "-A", env=env)
        git(live, "commit", "-q", "-m", "old", env=env)
        self.old_head = git(live, "rev-parse", "HEAD")
        # The rename commit: the new layout, with the deploy script this test runs.
        git(live, "checkout", "-q", "-b", "rename", env=env)
        deploy = os.path.join(live, "deployment/helena/native/deploy.sh")
        os.makedirs(os.path.dirname(deploy))
        with open(deploy, "w") as handle:
            handle.write("#!/bin/sh\nexit 0\n")
        os.chmod(deploy, 0o755)
        with open(os.path.join(live, "README.md"), "w") as handle:
            handle.write("new\n")
        git(live, "add", "-A", env=env)
        git(live, "commit", "-q", "-m", "rename", env=env)
        self.rename_head = git(live, "rev-parse", "HEAD")
        git(live, "checkout", "-q", "-b", "rename-rollback", env=env)
        git(live, "revert", "--no-edit", "HEAD", env=env)
        git(live, "checkout", "-q", "volition/native", env=env)
        dev = os.path.join(self.root, "srv/volition/source/plan-dev")
        git(live, "worktree", "add", "-q", "-b", "volition/hub", dev, env=env)

    def _test_map(self):
        rename_map = load_map()
        rename_map["database"]["databases"] = {"itsaplan_rt": "helena_rt", "itsaplan_rt_dev": "helena_rt_dev"}
        rename_map["database"]["roles"] = {"itsaplan_rt": "helena_rt"}
        path = os.path.join(self.work, "map.json")
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(rename_map, handle)
        return path

    def write_deploy_stub(self, name, body):
        path = os.path.join(self.work, name)
        with open(path, "w") as handle:
            handle.write("#!/bin/sh\nset -e\n" + body)
        os.chmod(path, 0o755)
        return path

    def migrate(self, *args, check=True):
        argv = [
            sys.executable,
            os.path.join(KIT, "migrate_live.py"),
            *args,
            "--map", self.map_path,
            "--root", self.root,
            "--backup-dir", "/var/backups/helena-rename/test",
            "--pg-connect", PG,
        ]
        result = subprocess.run(argv, env=self.env, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        if check and result.returncode != 0:
            self.fail("migrate %s failed:\n%s" % (args[0], result.stdout))
        return result

    def read(self, rel):
        with open(os.path.join(self.root, rel), encoding="utf-8") as handle:
            return handle.read()

    def units(self):
        with open(self.systemd, encoding="utf-8") as handle:
            return json.load(handle)["units"]

    # the tests -----------------------------------------------------------------------

    def forward_args(self, deploy):
        return [
            "--target-ref", "rename",
            "--rollback-ref", "rename-rollback",
            "--deploy-cmd", deploy,
        ]

    def deploy_stub(self):
        # Stands for the new deploy.sh: installs a canonical unit and a new snippet, and
        # applies the data migration of the rename commit.
        return self.write_deploy_stub(
            "deploy-new.sh",
            'printf "[Service]\\nUser=helena\\n" > "%(root)s/etc/systemd/system/helena-api.service"\n'
            'printf "x\\n" > "%(root)s/etc/nginx/snippets/helena-new.conf"\n'
            'psql %(pg)s -X -q -d helena_rt -c "UPDATE ai_agent SET runtime_policy = jsonb_set(runtime_policy, \'{mcpGrants}\', \'[\\"helena\\", \\"browser\\"]\'); '
            'INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (\'rename\', 2000);"\n'
            'touch "%(work)s/deployed-new"\n' % {"root": self.root, "pg": PG, "work": self.work},
        )

    def test_apply_verify_rollback(self):
        before = tree_digest(self.root)
        env_before = self.read("etc/volition/plan.env")
        self.migrate("preflight", *self.forward_args("/bin/true"))
        result = self.migrate("apply", *self.forward_args(self.deploy_stub()))
        self.assertIn("apply finished", result.stdout)
        # Nothing printed a secret value.
        for secret in ("secretpw", "do-not-change-me", "itp_secret_key_value", "itp_agent_secret"):
            self.assertNotIn(secret, result.stdout)

        # Paths moved, compatibility links in place.
        self.assertTrue(os.path.isdir(os.path.join(self.root, "srv/helena/source/helena/.git")))
        self.assertEqual(os.readlink(os.path.join(self.root, "srv/volition")), "helena")
        self.assertEqual(os.readlink(os.path.join(self.root, "var/lib/volition-google")), "helena-google")
        self.assertTrue(os.path.isdir(os.path.join(self.root, "var/lib/helena/app/storage")))
        self.assertEqual(
            os.readlink(os.path.join(self.root, "srv/helena/releases/web/current")),
            "/srv/helena/releases/web/20260924-003420-e5ad5546",
        )
        self.assertEqual(os.readlink(os.path.join(self.root, "var/lib/helena/hermes/venv/bin/python")), "/usr/bin/python3")

        # Env file: keys, paths and the database URL; the secret itself unchanged.
        env = self.read("etc/helena/helena.env")
        self.assertIn("DATABASE_URL=postgres://helena_rt:secretpw@127.0.0.1:5432/helena_rt\n", env)
        self.assertIn("BETTER_AUTH_SECRET=do-not-change-me\n", env)
        self.assertIn("HELENA_CONTROL_TOKEN_FILE=/etc/helena/control.token\n", env)
        self.assertIn("HELENA_VAULT_ROOT=/srv/helena/vault\n", env)
        self.assertIn("# retired by helena-rename: PLAN_SECRET_ALLOW_HOST=", env)
        self.assertEqual(self.read("etc/helena/runner-api.key"), "itp_secret_key_value\n")
        self.assertEqual(self.read("etc/helena/control.token"), "0123456789abcdef0123456789abcdef\n")
        # Backups of rewritten secret files are private.
        backup = os.path.join(self.root, "var/backups/helena-rename/test/files/etc/helena/helena.env")
        self.assertEqual(os.stat(backup).st_mode & 0o777, 0o600)

        # Users, groups, database.
        passwd = self.read("etc/passwd")
        self.assertIn("helena:x:999:990::/var/lib/helena/app:", passwd)
        self.assertIn("helena-hermes:x:996:990::/var/lib/helena/hermes:", passwd)
        self.assertNotIn("volition", passwd)
        self.assertNotIn("volition", self.read("etc/group"))
        names = set(self.psql("postgres", "SELECT datname FROM pg_database").split())
        self.assertIn("helena_rt", names)
        self.assertIn("helena_rt_dev", names)
        self.assertNotIn("itsaplan_rt", names)
        self.assertEqual(self.psql("postgres", "SELECT count(*) FROM pg_roles WHERE rolname = 'helena_rt'"), "1")
        self.assertEqual(self.psql("postgres", "SELECT datallowconn FROM pg_database WHERE datname = 'helena_rt'"), "t")

        # Units: renamed, rewritten, masked one retired, wants link re-pointed.
        unit_dir = os.path.join(self.root, "etc/systemd/system")
        self.assertFalse(os.path.lexists(os.path.join(unit_dir, "volition-plan-api-dev.service")))
        self.assertFalse(os.path.lexists(os.path.join(unit_dir, "helena-api-dev.service")))
        self.assertFalse(os.path.exists(os.path.join(unit_dir, "volition-hermes-gateway.service")))
        runner = self.read("etc/systemd/system/helena-runner.service")
        self.assertIn("User=helena-hermes", runner)
        self.assertIn("LoadCredential=itsaplan_api_key:/etc/helena/runner-api.key", runner)
        self.assertIn("ExecStart=/usr/local/libexec/helena-runner", runner)
        self.assertIn(
            "EnvironmentFile=/etc/helena/local-owner.env",
            self.read("etc/systemd/system/helena-api.service.d/50-local-owner.conf"),
        )
        self.assertEqual(
            os.readlink(os.path.join(unit_dir, "multi-user.target.wants/helena-api.service")),
            "/etc/systemd/system/helena-api.service",
        )
        self.assertIn("/srv/helena/dev-run", self.read("etc/systemd/system/nginx.service.d/helena-stale-socket.conf"))
        self.assertIn("helena-kiosk", self.read("etc/systemd/system/getty@tty1.service.d/autologin.conf"))
        self.assertIn(
            "Wants=helena-browser-chromium@%i.service", self.read("etc/systemd/system/helena-browser@.target")
        )
        # The deploy's own copy of the unit won over the rewritten one.
        self.assertEqual(self.read("etc/systemd/system/helena-api.service"), "[Service]\nUser=helena\n")

        # nginx, sudoers, polkit, libexec.
        site = self.read("etc/nginx/sites-available/helena.conf")
        self.assertIn("X-Helena-Local-Access $helena_local_owner_token", site)
        self.assertIn("https://plan.volition.one", site)
        self.assertIn("/etc/nginx/snippets/helena-owner-terminal.conf", site)
        self.assertEqual(
            os.readlink(os.path.join(self.root, "etc/nginx/sites-enabled/helena.conf")), "../sites-available/helena.conf"
        )
        self.assertTrue(os.path.exists(os.path.join(self.root, "etc/nginx/volition.conf.bak-owner-terminal")))
        self.assertEqual(
            self.read("etc/sudoers.d/91-helena-gog"),
            "wilhelmpa ALL=(helena-google) NOPASSWD: /usr/local/libexec/helena-gog-bridge\n",
        )
        polkit = self.read("etc/polkit-1/rules.d/60-helena-project-browser.rules")
        self.assertIn('"helena-hermes"', polkit)
        self.assertIn('"helena-browser"', polkit)
        runner_script = self.read("usr/local/libexec/helena-runner")
        self.assertIn("/etc/helena/runner/helena-runner.json", runner_script)
        self.assertIn("/srv/helena/source/helena/packages/runner/dist/cli.js", runner_script)

        # Hermes home and profiles.
        hermes = self.read("var/lib/helena/hermes/config.yaml")
        self.assertIn("  helena:\n", hermes)
        self.assertIn("${HELENA_API_KEY}", hermes)
        self.assertIn("- helena-approval-guard", hermes)
        self.assertTrue(os.path.isdir(os.path.join(self.root, "var/lib/helena/hermes/run/helena-managed")))
        self.assertTrue(os.path.isfile(os.path.join(self.root, "var/lib/helena/hermes/profiles/vol/run/helena-managed/SOUL.md")))
        self.assertTrue(os.path.isfile(os.path.join(self.root, "var/lib/helena/hermes/run/helena-runner.json")))
        descriptor = json.loads(self.read("var/lib/helena/hermes/run/agents/vol.json"))
        self.assertEqual(descriptor["apiKey"], "itp_agent_secret")
        self.assertEqual(descriptor["cwd"], "/srv/helena/workspaces/projects/vol")
        self.assertEqual(descriptor["hermesHome"], "/var/lib/helena/hermes/profiles/vol")
        self.assertIn("#!/var/lib/helena/hermes/venv/bin/python", self.read("var/lib/helena/hermes/venv/bin/pip"))
        self.assertIn(
            "/var/lib/helena/project-browser/projects/vol/profile",
            self.read("var/lib/helena/project-browser/projects/vol/runtime.env"),
        )
        syncthing = self.read("var/lib/helena/syncthing/config.xml")
        self.assertIn('id="volition"', syncthing)
        self.assertIn('path="/srv/helena/vault"', syncthing)
        self.assertIn("helena-google", self.read("home/wilhelmpa/.local/bin/gog"))

        # Git: the live checkout is at the rename commit, the moved worktree still works.
        live = os.path.join(self.root, "srv/helena/source/helena")
        dev = os.path.join(self.root, "srv/helena/source/helena-dev")
        self.assertEqual(git(live, "rev-parse", "HEAD"), self.rename_head)
        self.assertEqual(git(dev, "rev-parse", "--abbrev-ref", "HEAD"), "volition/hub")
        self.assertIn(dev, git(live, "worktree", "list"))

        # Units: old ones stopped and disabled, new ones enabled and started.
        units = self.units()
        self.assertEqual(units["volition-plan-api.service"]["active"], "inactive")
        self.assertEqual(units["volition-plan-api.service"]["file"], "disabled")
        self.assertEqual(units["helena-api.service"], {"file": "enabled", "active": "active"})
        self.assertEqual(units["helena-hermes-bootstrap.timer"]["active"], "active")
        self.assertEqual(units["helena-browser@vol.target"]["active"], "active")
        self.assertEqual(units["helena-browser-chromium@vol.service"]["active"], "active")
        self.assertNotIn("helena-hermes-gateway.service", units)
        self.assertTrue(os.path.exists(os.path.join(self.work, "deployed-new")))

        # Verify passes; the left-overs are only the ignored ones.
        verify = self.migrate("verify")
        self.assertIn("verify ok", verify.stdout)
        self.assertNotIn("helena.env:", verify.stdout)

        # A second apply is a no-op.
        again = self.migrate("apply", *self.forward_args("/bin/false"))
        self.assertIn("apply finished", again.stdout)

        # Rollback: everything back, the rollback ref deployed.
        rollback_deploy = self.write_deploy_stub("deploy-old.sh", 'touch "%s/deployed-old"\n' % self.work)
        result = self.migrate(
            "rollback", "--rollback-ref", "rename-rollback", "--rollback-deploy-cmd", rollback_deploy
        )
        self.assertIn("rollback finished", result.stdout)
        self.assertTrue(os.path.exists(os.path.join(self.work, "deployed-old")))
        self.assertTrue(os.path.isdir(os.path.join(self.root, "srv/volition/source/plan/.git")))
        self.assertFalse(os.path.lexists(os.path.join(self.root, "srv/helena")))
        self.assertFalse(os.path.lexists(os.path.join(self.root, "etc/helena")))
        self.assertEqual(self.read("etc/volition/plan.env"), env_before)
        self.assertEqual(self.read("etc/passwd"), FILES["etc/passwd"])
        self.assertEqual(self.read("etc/group"), FILES["etc/group"])
        self.assertEqual(self.read("etc/systemd/system/volition-plan-api.service"), FILES["etc/systemd/system/volition-plan-api.service"])
        self.assertEqual(os.readlink(os.path.join(self.root, "etc/systemd/system/volition-plan-api-dev.service")), "/dev/null")
        self.assertFalse(os.path.lexists(os.path.join(self.root, "etc/nginx/snippets/helena-new.conf")))
        self.assertFalse(os.path.lexists(os.path.join(self.root, "etc/systemd/system/helena-api.service")))
        names = set(self.psql("postgres", "SELECT datname FROM pg_database").split())
        self.assertIn("itsaplan_rt", names)
        self.assertNotIn("helena_rt", names)
        self.assertEqual(self.psql("itsaplan_rt", "SELECT count(*) FROM drizzle.__drizzle_migrations"), "1")
        self.assertEqual(
            self.psql("itsaplan_rt", "SELECT runtime_policy->'mcpGrants' FROM ai_agent"), '["itsaplan", "browser"]'
        )
        live = os.path.join(self.root, "srv/volition/source/plan")
        dev = os.path.join(self.root, "srv/volition/source/plan-dev")
        self.assertEqual(git(live, "rev-parse", "HEAD^{tree}"), git(live, "rev-parse", self.old_head + "^{tree}"))
        self.assertEqual(git(dev, "rev-parse", "--abbrev-ref", "HEAD"), "volition/hub")
        units = self.units()
        self.assertEqual(units["volition-plan-api.service"], {"file": "enabled", "active": "active"})
        self.assertEqual(units["volition-project-browser@vol.target"]["active"], "active")
        self.assertEqual(units["helena-api.service"]["active"], "inactive")
        self.assertEqual(units["helena-api.service"]["file"], "disabled")
        # Apart from the checkout's git history (the rollback commit), the tree is what it was.
        self.assertEqual(tree_digest(self.root), before)

    def test_resume_after_failure(self):
        marker = os.path.join(self.work, "fail-usermod")
        open(marker, "w").close()
        self.env["HELENA_RENAME_TEST_FAIL_USERMOD"] = marker
        failed = self.migrate("apply", *self.forward_args(self.deploy_stub()), check=False)
        self.assertNotEqual(failed.returncode, 0)
        self.assertIn("usermod", failed.stdout)
        # Groups were renamed before the failure, the paths not yet.
        self.assertTrue(os.path.isdir(os.path.join(self.root, "srv/volition/source/plan")))
        resumed = self.migrate("apply", *self.forward_args(self.deploy_stub()))
        self.assertIn("apply finished", resumed.stdout)
        self.assertIn("helena:x:999", self.read("etc/passwd"))
        self.migrate("verify")

    def test_dry_run_changes_nothing(self):
        before = tree_digest(self.root)
        self.migrate("apply", "--dry-run", *self.forward_args("/bin/true"))
        self.migrate("plan")
        self.assertEqual(tree_digest(self.root), before)
        names = set(self.psql("postgres", "SELECT datname FROM pg_database").split())
        self.assertIn("itsaplan_rt", names)

    def test_preflight_refuses_taken_names(self):
        os.makedirs(os.path.join(self.root, "srv/helena"))
        result = self.migrate("preflight", *self.forward_args("/bin/true"), check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("/srv/helena already exists", result.stdout)

    def test_preflight_refuses_bad_rollback_ref(self):
        live = os.path.join(self.root, "srv/volition/source/plan")
        git(live, "branch", "not-a-revert", "rename", env=self.git_env)
        result = self.migrate(
            "preflight", "--target-ref", "rename", "--rollback-ref", "not-a-revert", check=False
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("does not have the tree of HEAD", result.stdout)


if __name__ == "__main__":
    unittest.main()
