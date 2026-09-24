#!/usr/bin/env python3
"""Moves a running install from the old names (volition-*, itsaplan, /srv/volition ...) to Helena.

The one-step rename has two halves. The rename commit renames everything in the repository;
this script moves a live install to match it, in place, with a journal that makes every step
resumable and reversible:

  plan        what would change, nothing is written
  preflight   the checks apply runs first
  apply       stop, rename (database, groups, users, paths, units, config), fast-forward the
              live checkout to the rename commit, deploy it, start again
  verify      units, health URLs, database name, left-over old names
  rollback    undo every journaled action in reverse, then deploy the rollback ref
  finalize    remove the compatibility symlinks old path -> new path after the burn-in
  status      print the journal

Everything is driven by rename-map.json next to this file. Only root runs it on a live system;
the tests run it against a sandbox root (--root) with stub commands and a private Postgres.

Secrets: env files, runner descriptors and keys are edited in place and copied into the
backup directory (0700, files 0600). Nothing reads a value out loud: the output names files,
line numbers and matched tokens, never a line.
"""

import argparse
import datetime
import glob
import json
import os
import re
import shlex
import shutil
import stat
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
NAME_CHARS = "A-Za-z0-9_\\-"


class MigrationError(Exception):
    pass


# ---------------------------------------------------------------------------------------
# Rules: the content rewrite
# ---------------------------------------------------------------------------------------


def _alternation(pairs, before, after):
    """One regex over all pairs, longest first, each bounded by the given look-arounds."""
    ordered = sorted(pairs, key=lambda pair: len(pair[0]), reverse=True)
    parts = [before + re.escape(old) + after for old, _ in ordered]
    return re.compile("|".join(parts)) if parts else None


class Rules:
    """Token substitutions for one kind of file.

    kind: 'config' (units, nginx, sudoers ...): paths, names, prefixes, env names, words
          'env'    (env files): paths, names, prefixes, env keys and references, postgres URLs
          'hermes' (Hermes config, runner descriptors): paths, names, prefixes, env refs, hermesWords
          'data'   (everything else): paths, names, prefixes, env refs
    """

    def __init__(self, rename_map, kind):
        tokens = rename_map["tokens"]
        self.kind = kind
        exact = {}
        for section in ("paths", "names"):
            exact.update(_clean(tokens.get(section, {})))
        env_keys = _clean(rename_map.get("envKeys", {}))
        exact.update({k: v for k, v in env_keys.items() if v})
        if kind == "hermes":
            exact.update(_clean(tokens.get("hermesWords", {})))
        self.table = dict(exact)
        # A whole token: no name character on either side ('.' and '/' may border it).
        self.exact = _alternation(
            exact.items(), "(?<![" + NAME_CHARS + "])", "(?![" + NAME_CHARS + "])"
        )
        prefixes = dict(_clean(tokens.get("prefixes", {})))
        prefixes.update(_clean(rename_map.get("envPrefixes", {})))
        self.prefixes = prefixes
        self.prefix = _alternation(
            prefixes.items(), "(?<![" + NAME_CHARS + "])", "(?=[A-Za-z0-9])"
        )
        self.words = None
        if kind == "config":
            words = _clean(tokens.get("words", {}))
            self.word_table = words
            # Bare words: nothing name-like, no '.' and no '/' on either side, so a domain
            # (volition.one) or a foreign path keeps its spelling.
            self.words = _alternation(
                words.items(), "(?<![" + NAME_CHARS + "./@])", "(?![" + NAME_CHARS + ".])"
            )
        self.env_keys = env_keys
        self.databases = rename_map["database"]["databases"]
        self.roles = rename_map["database"]["roles"]

    def rewrite(self, text):
        count = 0
        if self.kind == "env":
            text, n = self._env_keys(text)
            count += n
            text, n = self._postgres_urls(text)
            count += n
        text, n = self._sub(self.exact, lambda m: self.table[m.group(0)], text)
        count += n
        text, n = self._sub(self.prefix, self._prefix_repl, text)
        count += n
        if self.words is not None:
            text, n = self._sub(self.words, lambda m: self.word_table[m.group(0)], text)
            count += n
        return text, count

    def _prefix_repl(self, match):
        return self.prefixes[match.group(0)]

    @staticmethod
    def _sub(pattern, repl, text):
        if pattern is None:
            return text, 0
        return pattern.subn(repl, text)

    def _env_keys(self, text):
        """Renames KEY in `KEY=value` / `export KEY=value`; a retired key is commented out."""
        count = 0
        out = []
        for line in text.splitlines(keepends=True):
            match = re.match(r"^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)(=.*)$", line, re.S)
            if match:
                lead, key, rest = match.groups()
                if key in self.env_keys:
                    new = self.env_keys[key]
                    count += 1
                    line = lead + new + rest if new else "# retired by helena-rename: " + line
                else:
                    for old, new in sorted(
                        self.prefixes.items(), key=lambda pair: len(pair[0]), reverse=True
                    ):
                        if old.isupper() and key.startswith(old):
                            line = lead + new + key[len(old):] + rest
                            count += 1
                            break
            out.append(line)
        return "".join(out), count

    def _postgres_urls(self, text):
        pattern = re.compile(
            r"(postgres(?:ql)?://)([^:@/\s'\"]+)((?::[^@\s'\"]*)?@[^/\s'\"]+/)([A-Za-z0-9_]+)"
        )
        count = [0]

        def repl(match):
            scheme, user, middle, db = match.groups()
            new_user = self.roles.get(user, user)
            new_db = self.databases.get(db, db)
            if (new_user, new_db) != (user, db):
                count[0] += 1
            return scheme + new_user + middle + new_db

        return pattern.sub(repl, text), count[0]

    def rename_name(self, name):
        """A file name through the same tokens, bounded more loosely: in `91-volition-gog` or
        `volition.conf` the old brand is a part of the name, and a part is renamed too."""
        if not hasattr(self, "_name_patterns"):
            bound_before, bound_after = "(?<![A-Za-z0-9_])", "(?![A-Za-z0-9_])"
            words = {"volition": "helena", "itsaplan": "helena"}
            self._name_patterns = (
                _alternation(self.table.items(), bound_before, "(?![A-Za-z0-9_-])"),
                _alternation(self.prefixes.items(), bound_before, "(?=[A-Za-z0-9])"),
                _alternation(words.items(), bound_before, bound_after),
                words,
            )
        exact, prefix, word, words = self._name_patterns
        new, _ = Rules._sub(exact, lambda m: self.table[m.group(0)], name)
        new, _ = Rules._sub(prefix, self._prefix_repl, new)
        new, _ = Rules._sub(word, lambda m: words[m.group(0)], new)
        return new


def _clean(mapping):
    return {k: v for k, v in mapping.items() if not k.startswith("$")}


def is_text(data):
    return b"\0" not in data[:8192]


# ---------------------------------------------------------------------------------------
# The migration
# ---------------------------------------------------------------------------------------


class Migration:
    def __init__(self, args):
        self.args = args
        self.root = os.path.abspath(args.root or "/")
        with open(args.map, encoding="utf-8") as handle:
            self.map = json.load(handle)
        self.dry_run = getattr(args, "dry_run", False)
        self.backup_dir = self.p(args.backup_dir)
        self.journal_path = os.path.join(self.backup_dir, "journal.jsonl")
        self.journal = self._load_journal()
        self.done = {entry["id"] for entry in self.journal if "id" in entry}
        self.rules = {kind: Rules(self.map, kind) for kind in ("config", "env", "hermes", "data")}
        self.pg_connect = shlex.split(args.pg_connect) if args.pg_connect else None
        self.old_roots = [entry["from"] for entry in self.map["roots"]]
        self.warnings = []

    # -- paths and commands ------------------------------------------------------------

    def p(self, path):
        """An absolute path of the target system, inside --root."""
        if self.root == "/":
            return path
        return os.path.join(self.root, path.lstrip("/"))

    def unp(self, path):
        if self.root == "/":
            return path
        return "/" + os.path.relpath(path, self.root)

    def log(self, message):
        print(message, flush=True)

    def warn(self, message):
        self.warnings.append(message)
        print("WARN " + message, flush=True)

    def run(self, argv, check=True, capture=False, input_text=None):
        if self.dry_run:
            self.log("  would run: " + " ".join(shlex.quote(a) for a in argv))
            return subprocess.CompletedProcess(argv, 0, "", "")
        result = subprocess.run(
            argv,
            input=input_text,
            text=True,
            stdout=subprocess.PIPE if capture else None,
            stderr=subprocess.PIPE if capture else None,
        )
        if check and result.returncode != 0:
            detail = (result.stderr or "").strip()[-400:] if capture else ""
            raise MigrationError("command failed (%d): %s %s" % (result.returncode, argv[0], detail))
        return result

    def query(self, run_argv):
        """A read-only command whose output is needed even in a dry run."""
        result = subprocess.run(run_argv, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        return result

    def pg(self, tool, database, sql=None, extra=None):
        if self.pg_connect is not None:
            argv = [tool] + self.pg_connect
        else:
            argv = ["runuser", "-u", "postgres", "--", tool]
        if tool == "psql":
            argv += ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-d", database]
            if sql is not None:
                argv += ["-c", sql]
        else:
            argv += ["-d", database]
        return argv + (extra or [])

    def sql_read(self, sql, database="postgres"):
        result = self.query(self.pg("psql", database, sql))
        if result.returncode != 0:
            raise MigrationError("psql failed: " + result.stderr.strip()[-300:])
        return result.stdout.strip()

    def sql_write(self, sql, database="postgres"):
        self.run(self.pg("psql", database, sql), capture=True)

    def as_owner(self, path, argv):
        owner = self.owner_of(path)
        if owner and self.root == "/" and owner != "root":
            return ["runuser", "-u", owner, "--"] + argv
        return argv

    def owner_of(self, path):
        try:
            uid = os.stat(path).st_uid
        except FileNotFoundError:
            return None
        for name, entry in self.passwd().items():
            if entry["uid"] == uid:
                return name
        return None

    # -- journal -------------------------------------------------------------------------

    def _load_journal(self):
        if not os.path.exists(self.journal_path):
            return []
        with open(self.journal_path, encoding="utf-8") as handle:
            return [json.loads(line) for line in handle if line.strip()]

    def record(self, entry):
        """Appends to the journal; a dry run keeps it in memory only."""
        entry = dict(entry)
        entry["at"] = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        if not self.dry_run:
            os.makedirs(self.backup_dir, mode=0o700, exist_ok=True)
            with open(self.journal_path, "a", encoding="utf-8") as handle:
                handle.write(json.dumps(entry, sort_keys=True) + "\n")
                handle.flush()
                os.fsync(handle.fileno())
        self.journal.append(entry)
        if "id" in entry:
            self.done.add(entry["id"])

    def backup_copy(self, path):
        """Keeps the original bytes and metadata of a file before it changes."""
        relative = self.unp(path).lstrip("/")
        target = os.path.join(self.backup_dir, "files", relative)
        if self.dry_run:
            return target
        os.makedirs(os.path.dirname(target), mode=0o700, exist_ok=True)
        if not os.path.exists(target):
            shutil.copy2(path, target, follow_symlinks=False)
            if not os.path.islink(target):
                os.chmod(target, 0o600)
        return target

    # -- users and groups (read from the target's own files) -------------------------------

    def passwd(self):
        entries = {}
        path = self.p("/etc/passwd")
        if os.path.exists(path):
            with open(path, encoding="utf-8") as handle:
                for line in handle:
                    parts = line.rstrip("\n").split(":")
                    if len(parts) >= 7:
                        entries[parts[0]] = {"uid": int(parts[2]), "home": parts[5]}
        return entries

    def groups(self):
        names = set()
        path = self.p("/etc/group")
        if os.path.exists(path):
            with open(path, encoding="utf-8") as handle:
                for line in handle:
                    if ":" in line:
                        names.add(line.split(":", 1)[0])
        return names

    def user_renames(self):
        users = self.passwd()
        renames = []
        for old, spec in _clean(self.map["users"]).items():
            if old in users:
                renames.append((old, spec["name"], spec.get("home")))
        for old_prefix, new_prefix in _clean(self.map.get("userPrefixes", {})).items():
            for name in sorted(users):
                if name.startswith(old_prefix):
                    renames.append((name, new_prefix + name[len(old_prefix):], None))
        return renames

    def group_renames(self):
        existing = self.groups()
        renames = [(old, new) for old, new in _clean(self.map["groups"]).items() if old in existing]
        for old_prefix, new_prefix in _clean(self.map.get("userPrefixes", {})).items():
            for name in sorted(existing):
                if name.startswith(old_prefix):
                    renames.append((name, new_prefix + name[len(old_prefix):]))
        return renames

    # -- systemd -------------------------------------------------------------------------

    def systemctl(self, *args, check=True):
        return self.run(["systemctl"] + list(args), check=check, capture=True)

    def legacy_units(self):
        """Every loaded or installed unit of the old names, with its enablement and state."""
        pattern = self.map.get("unitPattern", "volition-*")
        files = self.query(["systemctl", "list-unit-files", "--no-legend", "--full", pattern])
        units = {}
        for line in files.stdout.splitlines():
            parts = line.split()
            if len(parts) >= 2:
                units[parts[0]] = {"file": parts[1], "active": "inactive"}
        loaded = self.query(
            ["systemctl", "list-units", "--all", "--no-legend", "--plain", "--full", pattern]
        )
        for line in loaded.stdout.splitlines():
            parts = line.split()
            if len(parts) >= 3:
                entry = units.setdefault(parts[0], {"file": "transient", "active": "inactive"})
                entry["active"] = parts[2]
        return units

    def new_unit_name(self, name):
        """The Helena name of a unit, instances included; None for a retired unit."""
        units = self.map["units"]
        if name in units:
            return units[name]
        match = re.match(r"^(.+@)([^.]*)(\.[a-z]+)$", name)
        if match:
            template = match.group(1) + match.group(3)
            if template in units:
                target = units[template]
                if target is None:
                    return None
                return target.replace("@.", "@" + match.group(2) + ".")
        return self.rules["config"].rename_name(name)

    # -- steps ---------------------------------------------------------------------------

    def preflight(self, resuming=False):
        problems = []
        if self.root == "/" and os.geteuid() != 0:
            problems.append("run as root")
        if not resuming and self.done:
            problems.append("a journal exists at %s; use apply to resume or rollback" % self.journal_path)
        # Roots: old present, new absent, same filesystem.
        for entry in self.map["roots"]:
            old, new = self.p(entry["from"]), self.p(entry["to"])
            if "mv:" + entry["from"] in self.done:
                continue
            if os.path.lexists(new):
                problems.append("%s already exists" % entry["to"])
            if os.path.isdir(old) and not os.path.islink(old):
                parent_new = os.path.dirname(new)
                if os.path.isdir(parent_new) and os.stat(old).st_dev != os.stat(parent_new).st_dev:
                    problems.append(
                        "%s and %s are on different filesystems (a move would copy)"
                        % (entry["from"], os.path.dirname(entry["to"]))
                    )
        # Names that must be free.
        users = self.passwd()
        for old, new, _ in self.user_renames():
            if "usermod:" + old not in self.done and new in users:
                problems.append("user %s already exists" % new)
        groups = self.groups()
        targets = {}
        for old, new in self.group_renames():
            if new in targets:
                problems.append("groups %s and %s would both become %s" % (targets[new], old, new))
            targets[new] = old
            if "groupmod:" + old not in self.done and new in groups:
                problems.append("group %s already exists" % new)
        problems += self._preflight_database()
        problems += self._preflight_git()
        if problems:
            raise MigrationError("preflight failed:\n  - " + "\n  - ".join(problems))
        self.log("preflight ok")

    def _preflight_database(self):
        problems = []
        try:
            existing = set(self.sql_read("SELECT datname FROM pg_database").split())
            roles = set(self.sql_read("SELECT rolname FROM pg_roles").split())
        except MigrationError as error:
            return ["postgres is not reachable: %s" % error]
        for old, new in self.map["database"]["databases"].items():
            if "db:database:" + old in self.done:
                continue
            if old in existing and new in existing:
                problems.append("database %s already exists" % new)
        for old, new in self.map["database"]["roles"].items():
            if "db:role:" + old in self.done:
                continue
            if old in roles and new in roles:
                problems.append("role %s already exists" % new)
            if old in roles:
                md5 = self.sql_read(
                    "SELECT coalesce(bool_or(rolpassword LIKE 'md5%%'), false) FROM pg_authid WHERE rolname = '%s'"
                    % old
                )
                if md5 == "t":
                    problems.append(
                        "role %s has an md5 password, which a rename clears; set it again with "
                        "scram-sha-256 first" % old
                    )
        return problems

    def _preflight_git(self):
        problems = []
        target = self.args.target_ref
        if not target:
            return problems
        live = self.live_checkout(before=True)
        if not live:
            return ["the live checkout was not found"]
        git = self.as_owner(live, ["git", "-C", live])
        status = self.query(git + ["status", "--porcelain", "--untracked-files=no"])
        if status.stdout.strip():
            problems.append("the live checkout has uncommitted changes")
        if self.query(git + ["rev-parse", "--verify", "--quiet", target + "^{commit}"]).returncode:
            problems.append("target ref %s does not exist in the live checkout" % target)
        elif self.query(git + ["merge-base", "--is-ancestor", "HEAD", target]).returncode:
            problems.append("target ref %s is not a fast-forward of the live checkout" % target)
        else:
            marker = self.map.get("targetMarker")
            if marker and self.query(git + ["cat-file", "-e", target + ":" + marker]).returncode:
                problems.append("target ref %s does not contain %s" % (target, marker))
        rollback = self.args.rollback_ref
        if rollback:
            if self.query(git + ["rev-parse", "--verify", "--quiet", rollback + "^{commit}"]).returncode:
                problems.append("rollback ref %s does not exist" % rollback)
            else:
                code = next((e for e in self.journal if e.get("kind") == "code"), None)
                base = code["before"] if code else "HEAD"
                if self.query(git + ["diff", "--quiet", base, rollback]).returncode:
                    problems.append("rollback ref %s does not have the tree of HEAD" % rollback)
                if self.query(git + ["merge-base", "--is-ancestor", target, rollback]).returncode:
                    problems.append("rollback ref %s does not descend from %s" % (rollback, target))
        else:
            self.warn("no --rollback-ref: a rollback after the code step needs one (git revert of the rename commit)")
        return problems

    def live_checkout(self, before=False):
        new = self.map.get("liveCheckout")
        if not new:
            return None
        if before:
            old = self.old_path(new)
            if os.path.isdir(self.p(old)):
                return self.p(old)
        return self.p(new) if os.path.isdir(self.p(new)) else None

    def old_path(self, new_path):
        """The pre-migration spelling of a new path (inverse of roots + inner)."""
        for entry in sorted(self.map["inner"], key=lambda e: len(e["to"]), reverse=True):
            if new_path == entry["to"] or new_path.startswith(entry["to"] + "/"):
                new_path = entry["from"] + new_path[len(entry["to"]):]
                break
        for entry in sorted(self.map["roots"], key=lambda e: len(e["to"]), reverse=True):
            if new_path == entry["to"] or new_path.startswith(entry["to"] + "/"):
                return entry["from"] + new_path[len(entry["to"]):]
        return new_path

    # apply ----------------------------------------------------------------------------

    def apply(self):
        resuming = bool(self.done)
        self.preflight(resuming=resuming)
        if not self.dry_run:
            os.makedirs(self.backup_dir, mode=0o700, exist_ok=True)
            os.chmod(self.backup_dir, 0o700)
        if not resuming:
            self.record({"id": "begin", "kind": "begin", "map": os.path.abspath(self.args.map)})
        self.step_dump_databases()
        self.step_record_units()
        self.step_stop_units()
        self.step_database()
        self.step_groups_users()
        self.step_roots()
        self.step_inner()
        self.step_profile_entries()
        self.step_symlinks()
        self.step_git_worktrees()
        self.step_config()
        self.step_rewrite_files()
        self.step_reload()
        self.step_code()
        self.step_enable_units()
        self.step_deploy()
        self.step_start_units()
        self.record({"id": "done", "kind": "done"})
        self.log("apply finished; run verify")
        if self.warnings:
            self.log("%d warning(s) above" % len(self.warnings))

    def step_dump_databases(self):
        if "dump" in self.done or self.args.skip_dump:
            return
        existing = set(self.sql_read("SELECT datname FROM pg_database").split())
        dumps = []
        for old in self.map["database"]["databases"]:
            if old not in existing:
                continue
            target = os.path.join(self.backup_dir, "db", old + ".dump")
            self.log("dump database %s" % old)
            if not self.dry_run:
                os.makedirs(os.path.dirname(target), mode=0o700, exist_ok=True)
                with open(target, "wb") as out:
                    os.chmod(target, 0o600)
                    result = subprocess.run(
                        self.pg("pg_dump", old, extra=["--format=custom", "--no-owner"]),
                        stdout=out,
                        stderr=subprocess.PIPE,
                    )
                if result.returncode != 0:
                    raise MigrationError("pg_dump %s failed: %s" % (old, result.stderr.decode()[-300:]))
            dumps.append(target)
        self.record({"id": "dump", "kind": "dump", "files": dumps})

    def step_record_units(self):
        if "units-state" in self.done:
            return
        units = self.legacy_units()
        self.record(
            {"id": "units-state", "kind": "units-state", "units": units, "preexistingNew": self.helena_config_names()}
        )
        self.log("recorded %d units" % len(units))

    def helena_config_names(self):
        """Config entries already named helena* (a rollback leaves exactly these)."""
        names = []
        for root in self.map["configRoots"]["roots"]:
            base = self.p(root)
            if not os.path.isdir(base):
                continue
            for directory, dirs, files in os.walk(base):
                depth = os.path.relpath(directory, base).count(os.sep)
                if depth >= self.map["configRoots"].get("maxDepth", 3):
                    dirs[:] = []
                for name in list(files) + list(dirs):
                    if "helena" in name:
                        names.append(self.unp(os.path.join(directory, name)))
        return sorted(names)

    def units_state(self):
        for entry in self.journal:
            if entry.get("kind") == "units-state":
                return entry["units"]
        return {}

    def step_stop_units(self):
        if "stop" in self.done:
            return
        units = self.units_state()
        active = [name for name, u in units.items() if u["active"] in ("active", "activating", "reloading")]
        # Timers and sockets first, so nothing starts a service again while it stops.
        order = sorted(active, key=lambda n: (0 if n.endswith((".timer", ".socket", ".path")) else 1, n))
        if order:
            self.log("stop %s" % " ".join(order))
            self.systemctl("stop", *order)
        enabled = [name for name, u in units.items() if u["file"] in ("enabled", "enabled-runtime")]
        if enabled:
            self.systemctl("disable", *enabled)
        self.record({"id": "stop", "kind": "stop", "stopped": order, "disabled": enabled})

    def step_database(self):
        existing = set(self.sql_read("SELECT datname FROM pg_database").split())
        for old, new in self.map["database"]["databases"].items():
            action = "db:database:" + old
            if action in self.done or old not in existing:
                continue
            self.log("rename database %s -> %s" % (old, new))
            self.sql_write('ALTER DATABASE "%s" ALLOW_CONNECTIONS false' % old)
            self.sql_write(
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '%s' AND pid <> pg_backend_pid()"
                % old
            )
            self._wait_no_connections(old)
            self.sql_write('ALTER DATABASE "%s" RENAME TO "%s"' % (old, new))
            self.sql_write('ALTER DATABASE "%s" ALLOW_CONNECTIONS true' % new)
            self.record({"id": action, "kind": "db", "what": "database", "old": old, "new": new})
        roles = set(self.sql_read("SELECT rolname FROM pg_roles").split())
        for old, new in self.map["database"]["roles"].items():
            action = "db:role:" + old
            if action in self.done or old not in roles:
                continue
            self.log("rename role %s -> %s" % (old, new))
            self.sql_write('ALTER ROLE "%s" RENAME TO "%s"' % (old, new))
            self.record({"id": action, "kind": "db", "what": "role", "old": old, "new": new})

    def _wait_no_connections(self, database):
        if self.dry_run:
            return
        for _ in range(50):
            count = self.sql_read(
                "SELECT count(*) FROM pg_stat_activity WHERE datname = '%s' AND pid <> pg_backend_pid()" % database
            )
            if count == "0":
                return
            time.sleep(0.2)
        raise MigrationError("database %s still has connections" % database)

    def step_groups_users(self):
        for old, new in self.group_renames():
            action = "groupmod:" + old
            if action in self.done:
                continue
            self.log("rename group %s -> %s" % (old, new))
            self.run(["groupmod", "-n", new, old], capture=True)
            self.record({"id": action, "kind": "groupmod", "old": old, "new": new})
        users = self.passwd()
        for old, new, home in self.user_renames():
            action = "usermod:" + old
            if action in self.done:
                continue
            busy = self.query(["pgrep", "-u", old])
            if busy.returncode == 0 and busy.stdout.strip():
                raise MigrationError(
                    "user %s still runs processes %s; stop them first" % (old, " ".join(busy.stdout.split()))
                )
            argv = ["usermod", "-l", new]
            if home:
                argv += ["-d", home]
            self.log("rename user %s -> %s" % (old, new))
            self.run(argv + [old], capture=True)
            self.record(
                {"id": action, "kind": "usermod", "old": old, "new": new, "oldHome": users[old]["home"], "home": home}
            )

    def step_roots(self):
        for entry in self.map["roots"]:
            old, new = entry["from"], entry["to"]
            action = "mv:" + old
            if action in self.done or not os.path.lexists(self.p(old)):
                continue
            if os.path.islink(self.p(old)):
                self.warn("%s is already a symlink; left alone" % old)
                continue
            self.log("move %s -> %s" % (old, new))
            if not self.dry_run:
                os.makedirs(os.path.dirname(self.p(new)), exist_ok=True)
                os.rename(self.p(old), self.p(new))
            self.record({"id": action, "kind": "mv", "from": old, "to": new})
            # Anything that still names the old path keeps working until finalize.
            link_target = new
            if os.path.dirname(new) == os.path.dirname(old):
                link_target = os.path.basename(new)
            if not self.dry_run:
                os.symlink(link_target, self.p(old))
            self.record({"id": "compat:" + old, "kind": "symlink", "path": old, "target": link_target})

    def step_inner(self):
        for entry in self.map["inner"]:
            old, new = entry["from"], entry["to"]
            action = "mv:" + old
            if action in self.done or not os.path.lexists(self.p(old)):
                continue
            if os.path.lexists(self.p(new)):
                raise MigrationError("%s already exists" % new)
            self.log("move %s -> %s" % (old, new))
            if not self.dry_run:
                os.rename(self.p(old), self.p(new))
            self.record({"id": action, "kind": "mv", "from": old, "to": new})

    def step_profile_entries(self):
        spec = self.map.get("profileEntries")
        if not spec:
            return
        home = spec["hermesHome"]
        homes = [home] + sorted(
            self.unp(path) for path in glob.glob(os.path.join(self.p(home), "profiles", "*")) if os.path.isdir(path)
        )
        for base in homes:
            for old_rel, new_rel in _clean(spec["entries"]).items():
                old, new = base + "/" + old_rel, base + "/" + new_rel
                action = "mv:" + old
                if action in self.done or not os.path.lexists(self.p(old)):
                    continue
                if os.path.lexists(self.p(new)):
                    self.warn("%s and %s both exist; the old one is left for review" % (old, new))
                    continue
                if not self.dry_run:
                    os.rename(self.p(old), self.p(new))
                self.record({"id": action, "kind": "mv", "from": old, "to": new})

    def _retarget(self, target):
        rules = self.rules["data"]
        new, _ = rules.rewrite(target)
        return new

    def step_symlinks(self):
        prune = set(self.map.get("symlinkScan", {}).get("prune", []))
        roots = [entry["to"] for entry in self.map["roots"]]
        for new_root in roots:
            base = self.p(new_root)
            if not os.path.isdir(base):
                continue
            for directory, dirs, files in os.walk(base):
                dirs[:] = [d for d in dirs if d not in prune and not os.path.islink(os.path.join(directory, d))]
                candidates = files + [d for d in os.listdir(directory) if os.path.islink(os.path.join(directory, d))]
                for name in set(candidates):
                    path = os.path.join(directory, name)
                    if not os.path.islink(path):
                        continue
                    target = os.readlink(path)
                    if not any(target == old or target.startswith(old + "/") for old in self.old_roots):
                        continue
                    new_target = self._retarget(target)
                    if new_target == target:
                        continue
                    action = "ln:" + self.unp(path)
                    if action in self.done:
                        continue
                    self.log("re-point %s -> %s" % (self.unp(path), new_target))
                    if not self.dry_run:
                        tmp = path + ".helena-rename"
                        os.symlink(new_target, tmp)
                        os.replace(tmp, path)
                    self.record({"id": action, "kind": "retarget", "path": self.unp(path), "old": target, "new": new_target})

    def step_git_worktrees(self):
        if "worktrees" in self.done:
            return
        source = self.p(os.path.dirname(self.map.get("liveCheckout", "/srv/helena/source/x")))
        repaired = []
        if os.path.isdir(source):
            for name in sorted(os.listdir(source)):
                repo = os.path.join(source, name)
                if os.path.isdir(os.path.join(repo, ".git")):
                    worktrees = self._worktree_paths(repo)
                    argv = self.as_owner(repo, ["git", "-C", repo, "worktree", "repair"] + worktrees)
                    self.run(argv, check=False, capture=True)
                    repaired.append(self.unp(repo))
        self.record({"id": "worktrees", "kind": "worktrees", "repos": repaired})

    def _worktree_paths(self, repo, to_old=False):
        """Where the linked worktrees of a repository are now, read from their gitdir back-links.

        After the forward move a back-link still names the old path, which the rename rules
        turn into the new one; after a rollback it names the new path, which old_path turns back.
        """
        paths = []
        admin = os.path.join(repo, ".git", "worktrees")
        if not os.path.isdir(admin):
            return paths
        for name in sorted(os.listdir(admin)):
            try:
                with open(os.path.join(admin, name, "gitdir"), encoding="utf-8") as handle:
                    recorded = os.path.dirname(handle.read().strip())
            except FileNotFoundError:
                continue
            system_path = self.unp(recorded) if self.root != "/" and recorded.startswith(self.root) else recorded
            moved = self.old_path(system_path) if to_old else self._retarget(system_path)
            if os.path.isdir(self.p(moved)):
                paths.append(self.p(moved))
        return paths

    def _skip_name(self, name):
        return any(marker in name for marker in self.map.get("skipNames", []))

    def step_config(self):
        """Units first (the units map), then every other config root."""
        unit_dir = self.p(self.map["unitDirectory"])
        spec = self.map["configRoots"]
        for root in spec["roots"]:
            base = self.p(root)
            if not os.path.isdir(base):
                continue
            self._walk_config(base, spec.get("maxDepth", 3), base == unit_dir)
        self.record({"id": "config", "kind": "marker", "what": "config"})

    def _walk_config(self, base, max_depth, is_unit_dir, depth=0):
        try:
            names = sorted(os.listdir(base))
        except PermissionError:
            self.warn("cannot read %s" % self.unp(base))
            return
        for name in names:
            path = os.path.join(base, name)
            if self._skip_name(name):
                continue
            if os.path.isdir(path) and not os.path.islink(path):
                new_name = self._config_name(name, is_unit_dir and depth == 0)
                if new_name is not None and new_name != name:
                    path = self._rename_path(path, os.path.join(base, new_name))
                if depth + 1 < max_depth:
                    self._walk_config(path, max_depth, is_unit_dir, depth + 1)
                continue
            self._config_file(path, name, is_unit_dir, depth)

    def _config_name(self, name, top_level_unit):
        """New name of a config entry; None retires a unit."""
        if top_level_unit and not name.endswith((".d", ".wants", ".requires")):
            return self.new_unit_name(name)
        if name.endswith((".d", ".wants", ".requires")):
            unit, suffix = name.rsplit(".", 1)
            new_unit = self.new_unit_name(unit)
            return (new_unit or unit) + "." + suffix
        # A unit named inside a .wants/.requires directory follows the units map as well.
        if re.search(r"\.(service|timer|socket|target|path|mount)$", name):
            new = self.new_unit_name(name)
            return new if new else name
        return self.rules["config"].rename_name(name)

    def _config_file(self, path, name, is_unit_dir, depth):
        new_name = self._config_name(name, is_unit_dir and depth == 0)
        if new_name is None:
            self._retire(path)
            return
        if os.path.islink(path):
            target = os.readlink(path)
            new_target = self._retarget(target)
            base = os.path.basename(new_target)
            if re.search(r"\.(service|timer|socket|target|path|mount)$", os.path.basename(target)):
                unit = self.new_unit_name(os.path.basename(target))
                if unit is None:
                    self._retire(path)
                    return
                new_target = os.path.join(os.path.dirname(new_target), unit) if os.path.dirname(new_target) else unit
            elif not base:
                new_target = target
            if new_target != target:
                action = "ln:" + self.unp(path)
                if action not in self.done:
                    self.log("re-point %s -> %s" % (self.unp(path), new_target))
                    if not self.dry_run:
                        tmp = path + ".helena-rename"
                        os.symlink(new_target, tmp)
                        os.replace(tmp, path)
                    self.record({"id": action, "kind": "retarget", "path": self.unp(path), "old": target, "new": new_target})
        else:
            self._rewrite(path, self.rules["config"])
        if new_name != name:
            self._rename_path(path, os.path.join(os.path.dirname(path), new_name))

    def _retire(self, path):
        action = "retire:" + self.unp(path)
        if action in self.done:
            return
        target = os.path.join(self.backup_dir, "retired", self.unp(path).lstrip("/"))
        self.log("retire %s" % self.unp(path))
        if not self.dry_run:
            os.makedirs(os.path.dirname(target), mode=0o700, exist_ok=True)
            shutil.move(path, target)
        self.record({"id": action, "kind": "retire", "path": self.unp(path), "backup": target})

    def _rename_path(self, old, new):
        action = "mv:" + self.unp(old)
        if action in self.done:
            return new
        if os.path.lexists(new):
            raise MigrationError("%s already exists" % self.unp(new))
        self.log("rename %s -> %s" % (self.unp(old), os.path.basename(new)))
        if not self.dry_run:
            os.rename(old, new)
        self.record({"id": action, "kind": "mv", "from": self.unp(old), "to": self.unp(new)})
        return new if not self.dry_run else old

    def _rewrite(self, path, rules, max_bytes=None):
        max_bytes = max_bytes or self.map["rewriteFiles"].get("maxBytes", 1048576)
        try:
            info = os.lstat(path)
        except FileNotFoundError:
            return
        if not stat.S_ISREG(info.st_mode) or info.st_size > max_bytes:
            return
        with open(path, "rb") as handle:
            data = handle.read()
        if not is_text(data):
            return
        text = data.decode("utf-8", errors="surrogateescape")
        new_text, count = rules.rewrite(text)
        if count == 0 or new_text == text:
            return
        action = "rewrite:" + self.unp(path)
        if action in self.done:
            return
        backup = self.backup_copy(path)
        self.log("rewrite %s (%d change%s)" % (self.unp(path), count, "" if count == 1 else "s"))
        if not self.dry_run:
            tmp = path + ".helena-rename"
            with open(tmp, "wb") as handle:
                handle.write(new_text.encode("utf-8", errors="surrogateescape"))
            if os.geteuid() == 0:
                os.chown(tmp, info.st_uid, info.st_gid)
            os.chmod(tmp, stat.S_IMODE(info.st_mode))
            if "/sudoers.d/" in path and self.root == "/":
                check = subprocess.run(["visudo", "-cf", tmp], capture_output=True)
                if check.returncode != 0:
                    os.unlink(tmp)
                    raise MigrationError("visudo rejects the rewritten %s" % self.unp(path))
            os.replace(tmp, path)
        self.record({"id": action, "kind": "rewrite", "path": self.unp(path), "backup": backup})

    def step_rewrite_files(self):
        spec = self.map["rewriteFiles"]
        for kind in ("env", "hermes", "data"):
            for pattern in spec.get(kind, []):
                for path in sorted(glob.glob(self.p(pattern))):
                    if self._skip_name(os.path.basename(path)) or os.path.islink(path):
                        continue
                    self._rewrite(path, self.rules[kind], spec.get("maxBytes"))
        self.record({"id": "rewrite-files", "kind": "marker", "what": "rewrite-files"})

    def step_reload(self):
        self.systemctl("daemon-reload")
        if self.root == "/" and shutil.which("nginx"):
            result = self.run(["nginx", "-t"], check=False, capture=True)
            if result.returncode != 0:
                raise MigrationError("nginx -t fails after the rewrite; run rollback")

    def step_code(self):
        target = self.args.target_ref
        if not target or "code" in self.done:
            return
        live = self.live_checkout() or (self.live_checkout(before=True) if self.dry_run else None)
        if not live:
            raise MigrationError("the live checkout was not found at %s" % self.map.get("liveCheckout"))
        git = self.as_owner(live, ["git", "-C", live])
        before = self.query(git + ["rev-parse", "HEAD"]).stdout.strip()
        self.log("fast-forward %s to %s" % (self.unp(live), target))
        self.run(git + ["merge", "--ff-only", "--quiet", target], capture=True)
        after = self.query(git + ["rev-parse", "HEAD"]).stdout.strip() if not self.dry_run else target
        self.record({"id": "code", "kind": "code", "repo": self.unp(live), "before": before, "after": after})

    def new_units_to(self, which):
        """The Helena names of the old units that were `enabled` or `active`."""
        units = self.units_state()
        names = []
        for name, entry in units.items():
            if which == "enabled" and entry["file"] not in ("enabled", "enabled-runtime"):
                continue
            if which == "active" and entry["active"] not in ("active", "activating", "reloading"):
                continue
            new = self.new_unit_name(name)
            if new:
                names.append(new)
        return sorted(set(names))

    def step_enable_units(self):
        if "enable" in self.done:
            return
        enabled = self.new_units_to("enabled")
        if enabled:
            self.systemctl("enable", *enabled)
        self.record({"id": "enable", "kind": "enable", "units": enabled})

    def step_deploy(self):
        if "deploy" in self.done or not self.args.target_ref:
            return
        if self.args.skip_deploy:
            self.warn("deploy skipped (--skip-deploy)")
            return
        migrations = "0" if self.dry_run else self.max_migration()
        self.record({"id": "deploy-mark", "kind": "deploy-mark", "maxCreatedAt": migrations})
        command = self.args.deploy_cmd or self.default_deploy_cmd()
        self.log("deploy: %s" % command)
        self.run(shlex.split(command))
        self.record({"id": "deploy", "kind": "deploy", "command": command})

    def max_migration(self):
        database = self.new_database_name()
        if not database:
            return "0"
        exists = self.sql_read("SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL", database=database)
        if exists != "t":
            return "0"
        return self.sql_read("SELECT coalesce(max(created_at), 0) FROM drizzle.__drizzle_migrations", database=database)

    def default_deploy_cmd(self):
        live = self.map.get("liveCheckout")
        return "%s/deployment/helena/native/deploy.sh %s" % (live, self.args.target_ref)

    def new_database_name(self):
        databases = self.map["database"]["databases"]
        first = next(iter(databases), None)
        return databases.get(first) if first else None

    def step_start_units(self):
        if "start" in self.done:
            return
        active = self.new_units_to("active")
        if active:
            self.log("start %s" % " ".join(active))
            self.systemctl("start", *active, check=False)
        self.record({"id": "start", "kind": "start", "units": active})

    # verify -------------------------------------------------------------------------------

    def verify(self):
        failures = []
        for name in self.new_units_to("active"):
            result = self.query(["systemctl", "is-active", name])
            if result.stdout.strip() not in ("active", "activating"):
                failures.append("%s is %s" % (name, result.stdout.strip() or "unknown"))
        new_db = self.new_database_name()
        if new_db:
            names = set(self.sql_read("SELECT datname FROM pg_database").split())
            if new_db not in names:
                failures.append("database %s is missing" % new_db)
        if self.root == "/":
            for url in self.map.get("health", []):
                result = self.query(["curl", "-sf", "-o", "/dev/null", "--retry", "20", "--retry-delay", "1", "--retry-all-errors", url])
                if result.returncode != 0:
                    failures.append("%s does not answer" % url)
        residue = self.residue()
        for line in residue:
            self.log("left over: " + line)
        if failures:
            for failure in failures:
                self.log("FAIL " + failure)
            raise MigrationError("verify found %d problem(s)" % len(failures))
        self.log("verify ok (%d left-over name(s) to review)" % len(residue))
        return residue

    def residue(self):
        spec = self.map["residue"]
        pattern = re.compile(spec["pattern"], re.I)
        ignore = spec.get("ignore", [])
        found = []
        for root in spec["roots"]:
            base = self.p(root)
            if not os.path.exists(base):
                continue
            for directory, dirs, files in os.walk(base):
                dirs[:] = [d for d in dirs if not self._skip_name(d)]
                for name in list(files) + [d for d in dirs]:
                    path = os.path.join(directory, name)
                    if self._skip_name(name):
                        continue
                    if pattern.search(name):
                        found.append("%s (name)" % self.unp(path))
                    if not os.path.isfile(path) or os.path.islink(path):
                        continue
                    try:
                        if os.path.getsize(path) > 1048576:
                            continue
                        with open(path, "rb") as handle:
                            data = handle.read()
                    except (PermissionError, FileNotFoundError):
                        continue
                    if not is_text(data):
                        continue
                    for number, line in enumerate(data.decode("utf-8", "replace").splitlines(), 1):
                        if any(token in line for token in ignore):
                            continue
                        match = pattern.search(line)
                        if match:
                            found.append("%s:%d (%s)" % (self.unp(path), number, match.group(0)))
        return found

    # rollback -----------------------------------------------------------------------------

    def rollback(self):
        if not self.journal:
            raise MigrationError("no journal at %s" % self.journal_path)
        if any(entry.get("kind") == "finalize" for entry in self.journal) and not self.args.force:
            raise MigrationError("finalize ran; a rollback now needs --force")
        undone = {entry["undoes"] for entry in self.journal if entry.get("kind") == "undo"}
        code_rolled_back = False
        deployed = any(entry.get("kind") == "deploy" for entry in self.journal)
        for entry in reversed(self.journal):
            key = entry.get("id")
            if not key or key in undone or entry.get("kind") == "undo":
                continue
            kind = entry["kind"]
            if kind == "start":
                if entry.get("units"):
                    self.systemctl("stop", *entry["units"], check=False)
            elif kind == "enable":
                if entry.get("units"):
                    self.systemctl("disable", *entry["units"], check=False)
            elif kind == "deploy":
                self._rollback_sql()
            elif kind == "code":
                code_rolled_back = self._rollback_code(entry)
            elif kind == "rewrite":
                self._restore(entry["backup"], self.p(entry["path"]))
            elif kind == "retire":
                if os.path.lexists(entry["backup"]):
                    os.makedirs(os.path.dirname(self.p(entry["path"])), exist_ok=True)
                    shutil.move(entry["backup"], self.p(entry["path"]))
            elif kind == "retarget":
                path = self.p(entry["path"])
                if os.path.islink(path):
                    tmp = path + ".helena-rename"
                    os.symlink(entry["old"], tmp)
                    os.replace(tmp, path)
            elif kind == "symlink":
                path = self.p(entry["path"])
                if os.path.islink(path):
                    os.unlink(path)
            elif kind == "mv":
                if os.path.lexists(self.p(entry["to"])) and not os.path.lexists(self.p(entry["from"])):
                    os.rename(self.p(entry["to"]), self.p(entry["from"]))
                elif os.path.lexists(self.p(entry["from"])):
                    self.warn("%s exists again; %s left in place" % (entry["from"], entry["to"]))
            elif kind == "usermod":
                argv = ["usermod", "-l", entry["old"]]
                if entry.get("home"):
                    argv += ["-d", entry["oldHome"]]
                self.run(argv + [entry["new"]], capture=True)
            elif kind == "groupmod":
                self.run(["groupmod", "-n", entry["old"], entry["new"]], capture=True)
            elif kind == "db":
                self._rollback_db(entry)
            elif kind == "worktrees":
                pass  # repaired again below, once every path is back
            self.record({"id": "undo:" + key, "kind": "undo", "undoes": key})
        self._repair_worktrees_after_rollback()
        self._sweep_new_names()
        self.systemctl("daemon-reload", check=False)
        if deployed and code_rolled_back and self.args.rollback_deploy_cmd:
            self.log("deploy the rollback: %s" % self.args.rollback_deploy_cmd)
            self.run(shlex.split(self.args.rollback_deploy_cmd))
        elif deployed:
            self.warn("the rename commit was deployed; run the old deploy.sh with the rollback ref now")
        units = self.units_state()
        enabled = [n for n, u in units.items() if u["file"] in ("enabled", "enabled-runtime")]
        active = [n for n, u in units.items() if u["active"] in ("active", "activating", "reloading")]
        if enabled:
            self.systemctl("enable", *enabled, check=False)
        if active:
            self.systemctl("start", *active, check=False)
        self.record({"id": "rolled-back", "kind": "rolled-back"})
        self.log("rollback finished")

    def _restore(self, backup, path):
        if not os.path.lexists(backup):
            self.warn("backup of %s is missing" % self.unp(path))
            return
        tmp = path + ".helena-rename"
        shutil.copy2(backup, tmp, follow_symlinks=False)
        try:
            info = os.lstat(path)
            if os.geteuid() == 0:
                os.chown(tmp, info.st_uid, info.st_gid)
            os.chmod(tmp, stat.S_IMODE(info.st_mode))
        except FileNotFoundError:
            pass
        os.replace(tmp, path)

    def _rollback_db(self, entry):
        if entry["what"] == "database":
            new, old = entry["new"], entry["old"]
            self.sql_write('ALTER DATABASE "%s" ALLOW_CONNECTIONS false' % new)
            self.sql_write(
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '%s' AND pid <> pg_backend_pid()" % new
            )
            self._wait_no_connections(new)
            self.sql_write('ALTER DATABASE "%s" RENAME TO "%s"' % (new, old))
            self.sql_write('ALTER DATABASE "%s" ALLOW_CONNECTIONS true' % old)
        else:
            self.sql_write('ALTER ROLE "%s" RENAME TO "%s"' % (entry["new"], entry["old"]))

    def _rollback_sql(self):
        database = self.new_database_name()
        mark = next((e for e in self.journal if e.get("kind") == "deploy-mark"), None)
        for statement in self.map["database"].get("rollbackSql", []):
            self.sql_write(statement, database=database)
        exists = self.sql_read("SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL", database=database)
        if mark is not None and exists == "t":
            self.sql_write(
                "DELETE FROM drizzle.__drizzle_migrations WHERE created_at > %d" % int(mark["maxCreatedAt"]),
                database=database,
            )

    def _rollback_code(self, entry):
        ref = self.args.rollback_ref
        repo = self.p(entry["repo"])
        if not ref:
            self.warn("no --rollback-ref: the live checkout stays at %s" % entry["after"][:12])
            return False
        git = self.as_owner(repo, ["git", "-C", repo])
        self.log("fast-forward %s to the rollback ref %s" % (entry["repo"], ref))
        self.run(git + ["merge", "--ff-only", "--quiet", ref], capture=True)
        return True

    def _repair_worktrees_after_rollback(self):
        for entry in self.journal:
            if entry.get("kind") != "worktrees":
                continue
            for repo in entry.get("repos", []):
                old_repo = self.p(self.old_path(repo))
                if os.path.isdir(old_repo):
                    worktrees = self._worktree_paths(old_repo, to_old=True)
                    argv = self.as_owner(old_repo, ["git", "-C", old_repo, "worktree", "repair"] + worktrees)
                    self.run(argv, check=False, capture=True)

    def _sweep_new_names(self):
        """Helena-named config the deploy installed is moved aside, so the old names stand alone."""
        preexisting = set()
        for entry in self.journal:
            if entry.get("kind") == "units-state":
                preexisting = set(entry.get("preexistingNew", []))
        for path in reversed(self.helena_config_names()):
            if path in preexisting or not os.path.lexists(self.p(path)):
                continue
            target = os.path.join(self.backup_dir, "rollback-leftovers", path.lstrip("/"))
            os.makedirs(os.path.dirname(target), mode=0o700, exist_ok=True)
            shutil.move(self.p(path), target)
            self.log("moved aside %s" % path)

    # finalize / status --------------------------------------------------------------------

    def finalize(self):
        residue = [line for line in self.residue() if not line.endswith("(name)")]
        if residue and not self.args.force:
            raise MigrationError("%d left-over reference(s); fix them or use --force" % len(residue))
        for entry in self.journal:
            if entry.get("kind") == "symlink":
                path = self.p(entry["path"])
                if os.path.islink(path):
                    self.log("remove compatibility link %s" % entry["path"])
                    if not self.dry_run:
                        os.unlink(path)
        self.record({"id": "finalize", "kind": "finalize"})

    def status(self):
        for entry in self.journal:
            detail = {k: v for k, v in entry.items() if k not in ("units",)}
            print(json.dumps(detail, sort_keys=True))

    def plan(self):
        self.dry_run = True
        try:
            self.preflight()
        except MigrationError as error:
            self.log(str(error))
        units = self.legacy_units()
        self.log("units:")
        for name in sorted(units):
            self.log("  %s -> %s (%s, %s)" % (name, self.new_unit_name(name), units[name]["file"], units[name]["active"]))
        self.log("groups:")
        for old, new in self.group_renames():
            self.log("  %s -> %s" % (old, new))
        self.log("users:")
        for old, new, home in self.user_renames():
            self.log("  %s -> %s%s" % (old, new, " (home %s)" % home if home else ""))
        self.log("paths:")
        for entry in self.map["roots"] + self.map["inner"]:
            if os.path.lexists(self.p(entry["from"])) or os.path.lexists(self.p(self.old_path(entry["from"]))):
                self.log("  %s -> %s" % (entry["from"], entry["to"]))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["plan", "preflight", "apply", "verify", "rollback", "finalize", "status"])
    parser.add_argument("--map", default=os.path.join(HERE, "rename-map.json"))
    parser.add_argument("--root", default="/", help="sandbox root for tests; / on the live system")
    parser.add_argument(
        "--backup-dir",
        default="/var/backups/helena-rename/current",
        help="journal, dumps and original files (inside --root)",
    )
    parser.add_argument("--target-ref", help="the rename commit (a branch) the live checkout fast-forwards to")
    parser.add_argument("--rollback-ref", help="a branch with the rename commit reverted (tree of the old HEAD)")
    parser.add_argument("--deploy-cmd", help="deploy command after the code step (default: the new deploy.sh)")
    parser.add_argument("--rollback-deploy-cmd", help="deploy command after a rollback (the old deploy.sh)")
    parser.add_argument("--skip-deploy", action="store_true")
    parser.add_argument("--skip-dump", action="store_true", help="no pg_dump before the change (tests only)")
    parser.add_argument("--pg-connect", help="psql/pg_dump connection options instead of runuser -u postgres")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args(argv)
    migration = Migration(args)
    try:
        getattr(migration, args.command)()
    except MigrationError as error:
        print("helena-rename: %s" % error, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
