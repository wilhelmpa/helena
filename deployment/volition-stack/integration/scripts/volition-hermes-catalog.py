#!/usr/bin/env python3
"""Build the Plan runner catalog from Hermes' configured provider.

The output contains no credentials. Hermes remains the source of truth for provider selection,
account-scoped model discovery, and per-model reasoning capabilities.
"""

from __future__ import annotations

import json
import os
import re
import sys
import tempfile
import stat
from pathlib import Path
from typing import Any

MAX_MODELS = 200
COORDINATOR_DESCRIPTOR = re.compile(r'[a-z0-9][a-z0-9-]{0,63}')
PROJECT_AGENT_DESCRIPTOR = re.compile(r'([a-z0-9][a-z0-9-]{0,31})_([1-9][0-9]{0,9})')
PLAN_USERNAME = re.compile(r'[A-Za-z0-9._-]{1,64}')
APPROVAL_GUARD = 'plan-approval-guard'
# The live checkout, which the agent user cannot change.
PLAN_PLUGIN_ROOT = Path('/srv/volition/source/plan/deployment/volition-stack/integration/hermes-plugins')


def model_name(model_id: str) -> str:
    leaf = model_id.rsplit('/', 1)[-1]
    # A trailing release date (claude-opus-4-20250514) is left out, and adjacent version
    # numbers are one version (claude-opus-4-5 is Opus 4.5).
    words = [word for word in re.split(r'[-_]+', leaf) if not re.fullmatch(r'\d{8}', word)]
    merged: list[str] = []
    for word in words:
        if merged and word.isdigit() and re.fullmatch(r'\d+(\.\d+)*', merged[-1]):
            merged[-1] = f'{merged[-1]}.{word}'
        else:
            merged.append(word)
    rendered: list[str] = []
    for word in merged:
        lower = word.lower()
        if lower == 'gpt':
            rendered.append('GPT')
        elif lower == 'claude':
            rendered.append('Claude')
        elif lower == 'gemini':
            rendered.append('Gemini')
        elif lower == 'codex':
            rendered.append('Codex')
        elif lower == '900k':
            rendered.append('900K')
        elif lower in {'xai', 'glm', 'qwen'}:
            rendered.append(lower.upper())
        else:
            rendered.append(word.capitalize())
    return ' '.join(rendered)


def configured_route() -> tuple[str, str | None]:
    from hermes_cli.config import load_config_readonly
    from hermes_cli.models import normalize_provider

    config = load_config_readonly()
    model = config.get('model') if isinstance(config, dict) else None
    if not isinstance(model, dict):
        return '', None
    raw_provider = str(model.get('provider') or '').strip()
    provider = normalize_provider(raw_provider) if raw_provider else ''
    if provider in {'', 'auto'}:
        return '', None
    default = str(model.get('default') or model.get('model') or '').strip() or None
    return provider, default


def reasoning_levels(provider: str, model_id: str) -> list[str]:
    if provider == 'copilot':
        from hermes_cli.models import github_model_reasoning_efforts

        return github_model_reasoning_efforts(model_id)
    if provider == 'openai-codex':
        from agent.reasoning_effort import codex_supported_efforts

        return list(codex_supported_efforts(model_id))

    from hermes_cli.main_provider_setup import _main_model_reasoning_efforts

    return _main_model_reasoning_efforts(model_id, provider) or []


def split_profile(enabled: set[str], mcp_servers: set[str]) -> dict[str, list[str]]:
    """Hermes lists the enabled MCP servers among the platform toolsets; the runner keeps them apart."""
    return {
        'toolsets': sorted(name for name in enabled if name not in mcp_servers),
        'mcpServers': sorted(name for name in enabled if name in mcp_servers),
    }


def hermes_profile() -> dict[str, list[str]]:
    """What Hermes enables for the cli platform. Every agent home links the global config.yaml."""
    from hermes_cli.config import load_config_readonly
    from hermes_cli.tools_config import _get_platform_tools, enabled_mcp_server_names

    config = load_config_readonly()
    return split_profile(set(_get_platform_tools(config, 'cli')), enabled_mcp_server_names(config))


def require_browser_toolset(profile: dict[str, list[str]]) -> None:
    if 'browser' not in profile['toolsets']:
        raise RuntimeError('The Hermes browser toolset must be enabled for Plan project agents')


def hermes_approvals() -> dict[str, Any]:
    """How Hermes decides a dangerous command in a single-query run, and the plugins it loads."""
    from hermes_cli.plugins_discovery import _get_disabled_plugins, _get_enabled_plugins
    from tools.approval_context import _get_single_query_approval_mode

    return {
        'singleQueryMode': _get_single_query_approval_mode(),
        'plugins': sorted((_get_enabled_plugins() or set()) - _get_disabled_plugins()),
    }


def require_approval_guard(approvals: dict[str, Any]) -> None:
    """Runs pass no --yolo. single_query_mode: approve lets Hermes run a dangerous command, so
    the guard has to be the one that asks Plan."""
    if approvals['singleQueryMode'] == 'approve' and APPROVAL_GUARD not in approvals['plugins']:
        raise RuntimeError(f'approvals.single_query_mode: approve needs {APPROVAL_GUARD} in plugins.enabled')


def plan_plugins(plugin_root: Path) -> dict[str, str]:
    """The plugin links the runner keeps in every home it serves, restoring one an agent removed."""
    return {APPROVAL_GUARD: str(plugin_root / APPROVAL_GUARD)}


def link_plan_plugins(home: Path, plugin_root: Path) -> None:
    source = plugin_root / APPROVAL_GUARD
    if not (source / '__init__.py').is_file():
        raise RuntimeError('The Plan approval guard plugin is missing')
    plugins = home / 'plugins'
    plugins.mkdir(mode=0o700, exist_ok=True)
    target = plugins / APPROVAL_GUARD
    if target.is_symlink() and target.readlink() == source:
        return
    if target.exists() or target.is_symlink():
        raise RuntimeError('A Hermes plugin conflicts with the Plan approval guard')
    target.symlink_to(source)


def configured_reasoning_default() -> str | None:
    from hermes_cli.config import load_config_readonly

    config = load_config_readonly()
    agent = config.get('agent') if isinstance(config, dict) else None
    if not isinstance(agent, dict):
        return None
    value = str(agent.get('reasoning_effort') or '').strip().lower()
    return value or None


def provider_model_ids(provider: str) -> list[str]:
    # Hermes deliberately keeps diagnostics read-only. For the selected Codex provider we may
    # still read the Codex CLI's existing, unexpired login and ask the account-scoped endpoint;
    # this neither copies nor refreshes a credential and is what lets gated models such as Astra
    # appear only for accounts that actually expose them.
    if provider == 'openai-codex':
        from hermes_cli.auth_codex import _import_codex_cli_tokens
        from hermes_cli.codex_models import get_codex_model_ids

        tokens = _import_codex_cli_tokens()
        access_token = str((tokens or {}).get('access_token') or '').strip()
        if access_token:
            live = get_codex_model_ids(access_token=access_token)
            if live:
                return live

    from hermes_cli.models import cached_provider_model_ids

    return cached_provider_model_ids(provider, force_refresh=True)


def discover_catalog(provider: str) -> list[dict[str, Any]]:
    ids = provider_model_ids(provider)
    default_reasoning = configured_reasoning_default()
    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    for raw in ids:
        model_id = str(raw or '').strip()
        if not model_id or model_id in seen:
            continue
        seen.add(model_id)
        levels = list(dict.fromkeys(reasoning_levels(provider, model_id)))
        result.append(
            {
                'id': model_id,
                'name': model_name(model_id),
                'reasoning': bool(levels),
                'thinkingLevels': levels,
                'thinkingDefault': default_reasoning if default_reasoning in levels else None,
            }
        )
        if len(result) == MAX_MODELS:
            break
    return result



# Providers besides the configured one whose models the catalog also lists once Hermes
# holds a login for them, so each agent can run on either.
ADDITIONAL_PROVIDERS = ('anthropic',)


def logged_in(provider: str) -> bool:
    from agent.credential_pool import load_pool

    return load_pool(provider).has_credentials()


def catalog_models(provider: str) -> list[dict[str, Any]]:
    """The configured provider's models, then those of each additional provider Hermes is
    logged in to, each marked with its provider. An additional provider that cannot be read
    is left out, so it never stops the runner from starting."""
    sources = [(provider, discover_catalog)] if provider else []
    for extra in ADDITIONAL_PROVIDERS:
        if extra == provider:
            continue
        try:
            if logged_in(extra):
                sources.append((extra, discover_catalog))
        except Exception as exc:  # noqa: BLE001 - reported and skipped
            print(f'Hermes catalog: skipping {extra}: {exc}', file=sys.stderr)
    models: list[dict[str, Any]] = []
    seen: set[str] = set()
    for name, discover in sources:
        try:
            entries = discover(name)
        except Exception as exc:  # noqa: BLE001 - only the configured provider is required
            if name == provider:
                raise
            print(f'Hermes catalog: skipping {name}: {exc}', file=sys.stderr)
            continue
        # A provider can list one model under two ids (claude-fable-5-1, claude-fable-5.1);
        # the first keeps the name.
        names: set[str] = set()
        for entry in entries:
            if entry['id'] in seen or entry['name'] in names or len(models) == MAX_MODELS:
                continue
            seen.add(entry['id'])
            names.add(entry['name'])
            models.append({**entry, 'provider': name})
    return models


def private_file(file_path: Path, label: str) -> None:
    metadata = file_path.lstat()
    if not stat.S_ISREG(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode) or metadata.st_mode & 0o077:
        raise RuntimeError(f'{label} must be a private regular file')


def private_directory(directory: Path) -> None:
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    metadata = directory.lstat()
    if not stat.S_ISDIR(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode):
        raise RuntimeError('Hermes runner descriptor root is invalid')
    os.chmod(directory, 0o700)



def project_browser_env(
    browser_root: Path | None,
    slug: str,
    project_id: int,
    declared_cdp_url: str | None = None,
) -> dict[str, str]:
    if browser_root is None:
        return {}
    try:
        root_metadata = browser_root.lstat()
    except FileNotFoundError:
        return {}
    if root_metadata.st_uid != os.geteuid():
        # The browser state belongs to the browser user (agent isolation): its endpoints are
        # not the runner's to hand out.
        return {}
    if (
        not stat.S_ISDIR(root_metadata.st_mode)
        or stat.S_ISLNK(root_metadata.st_mode)
        or root_metadata.st_mode & 0o077
    ):
        raise RuntimeError('Hermes project browser root is invalid')
    project_root = browser_root / slug
    try:
        project_metadata = project_root.lstat()
    except FileNotFoundError:
        return {}
    if (
        not stat.S_ISDIR(project_metadata.st_mode)
        or stat.S_ISLNK(project_metadata.st_mode)
        or project_metadata.st_mode & 0o077
    ):
        raise RuntimeError('Hermes project browser state is invalid')
    state_path = project_root / 'runtime.json'
    private_file(state_path, 'Hermes project browser state')
    try:
        state = json.loads(state_path.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError('Hermes project browser state is invalid') from exc
    cdp_port = state.get('cdpPort') if isinstance(state, dict) else None
    display = state.get('display') if isinstance(state, dict) else None
    xauthority = project_root / 'run' / 'Xauthority'
    private_file(xauthority, 'Hermes project browser Xauthority')
    if (
        not isinstance(state, dict)
        or state.get('schemaVersion') != 1
        or state.get('slug') != slug
        or state.get('projectId') != project_id
        or not isinstance(cdp_port, int)
        or isinstance(cdp_port, bool)
        or cdp_port < 1024
        or cdp_port > 65535
        or not isinstance(display, int)
        or isinstance(display, bool)
        or display < 1
        or display > 4096
    ):
        raise RuntimeError('Hermes project browser state conflicts with its project')
    cdp_url = f'http://127.0.0.1:{cdp_port}'
    if declared_cdp_url is not None and declared_cdp_url != cdp_url:
        raise RuntimeError('Hermes project browser endpoint conflicts with its descriptor')
    return {
        'BROWSER_CDP_URL': cdp_url,
        'DISPLAY': f':{display}',
        'XAUTHORITY': str(xauthority),
    }


def descriptor_identity(name: str, item: dict[str, Any]) -> tuple[str, str] | None:
    """The project slug and Plan username a descriptor must carry, from its file name:
    `<slug>` is the project's coordinator, `<slug>_<agentId>` another agent of the project."""
    if COORDINATOR_DESCRIPTOR.fullmatch(name):
        return name, f'hermes-{name}-coordinator'
    match = PROJECT_AGENT_DESCRIPTOR.fullmatch(name)
    username = item.get('username')
    if (
        match
        and item.get('planAgentId') == int(match.group(2))
        and isinstance(username, str)
        and PLAN_USERNAME.fullmatch(username)
    ):
        return match.group(1), username
    return None


# The runtimes a project agent's descriptor may name besides Hermes: the runner starts them
# with its preset of that name, in the agent's profile directory as its home
# (packages/runner/src/cli-runtime.ts).
CLI_RUNTIMES = ('claude', 'codex')

# What a Claude Code agent can be set to, by Claude Code's own aliases: each follows the
# newest model of its family, so the list needs no update when a model is released. The
# levels are Claude Code's --effort (docs: model-config).
CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
CLAUDE_MODELS = [
    {'id': 'fable', 'name': 'Claude Fable', 'reasoning': True, 'thinkingLevels': CLAUDE_EFFORTS, 'thinkingDefault': None},
    {'id': 'opus', 'name': 'Claude Opus', 'reasoning': True, 'thinkingLevels': CLAUDE_EFFORTS, 'thinkingDefault': None},
    {'id': 'sonnet', 'name': 'Claude Sonnet', 'reasoning': True, 'thinkingLevels': CLAUDE_EFFORTS, 'thinkingDefault': None},
    {'id': 'haiku', 'name': 'Claude Haiku', 'reasoning': False, 'thinkingLevels': [], 'thinkingDefault': None},
]


def cli_models(runtime: str, hermes_models: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The models an agent of this runtime can be set to. Codex signs in to the same ChatGPT
    Codex backend as Hermes' openai-codex provider, so it offers that provider's models, which
    the account really has; Claude Code offers its aliases."""
    if runtime == 'claude':
        return [dict(model) for model in CLAUDE_MODELS]
    return [
        {key: value for key, value in model.items() if key != 'provider'}
        for model in hermes_models
        if model.get('provider') == 'openai-codex'
    ]


def descriptor_runtime(item: dict[str, Any]) -> str:
    runtime = item.get('runtime', 'hermes')
    if runtime != 'hermes' and runtime not in CLI_RUNTIMES:
        raise RuntimeError('Hermes runner descriptor names an unknown runtime')
    return runtime


def cli_entry(
    runtime: str,
    username: str,
    item: dict[str, Any],
    home: Path,
    slug: str,
    profile: str,
    isolated: bool,
) -> dict[str, Any]:
    """A Claude Code or Codex agent: its profile directory is its home. The runner keeps its
    skills below it, Claude Code its sessions and settings in .claude, Codex in .codex. No
    Hermes file is linked into it, and its login reaches it per run (never from here)."""
    if not isolated:
        private_directory(home)
    env = {
        'HELENA_AGENT_HOME': str(home),
        **(
            {'CLAUDE_CONFIG_DIR': str(home / '.claude')}
            if runtime == 'claude'
            else {'CODEX_HOME': str(home / '.codex')}
        ),
    }
    entry: dict[str, Any] = {
        'name': username,
        'apiKey': item['apiKey'],
        'cwd': item['cwd'],
        'runtime': runtime,
        'env': env,
    }
    if isolated:
        entry['isolation'] = {'slug': slug, 'profile': profile, 'agentId': item['planAgentId']}
    return entry


def isolation_enabled() -> bool:
    return os.environ.get('AGENT_ISOLATION', '').strip() == 'on'


# Where the Home agent works when agents are isolated: a workspace of its own, since the
# parent of every project's workspace is no longer one it may see.
HOME_WORKSPACE = os.environ.get('HERMES_HOME_WORKSPACE', '/srv/volition/workspaces/home')


def descriptor_entries(
    root: Path,
    global_home: Path,
    browser_root: Path | None = None,
    isolated: bool = False,
    problems: list[str] | None = None,
) -> list[dict[str, Any]]:
    """One runner entry per descriptor. With `problems`, a descriptor that cannot be served is
    left out and named there, so one broken agent does not keep every other one from starting;
    without it the first problem is raised."""
    private_directory(root)
    entries: list[dict[str, Any]] = []
    global_home = global_home.resolve(strict=True)
    profiles_root = (global_home / 'profiles').resolve(strict=False)
    for descriptor_path in sorted(root.glob('*.json')):
        try:
            entry = descriptor_entry(descriptor_path, global_home, profiles_root, browser_root, isolated)
        except RuntimeError as exc:
            if problems is None:
                raise
            problems.append(f'{descriptor_path.stem}: {exc}')
            continue
        entries.append(entry)
    return entries


def descriptor_entry(
    descriptor_path: Path,
    global_home: Path,
    profiles_root: Path,
    browser_root: Path | None,
    isolated: bool,
) -> dict[str, Any]:
    private_file(descriptor_path, 'Hermes runner descriptor')
    try:
        item = json.loads(descriptor_path.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError('Hermes runner descriptor is invalid') from exc
    if not isinstance(item, dict):
        raise RuntimeError('Hermes runner descriptor is invalid')
    identity = descriptor_identity(descriptor_path.stem, item)
    if identity is None:
        raise RuntimeError('Hermes runner descriptor conflicts with its project')
    slug, username = identity
    home = profiles_root / descriptor_path.stem
    expected = {
        'schemaVersion': 1,
        'username': username,
        'hermesHome': str(home),
        'globalHermesHome': str(global_home),
    }
    if (
        item.get('schemaVersion') != expected['schemaVersion']
        or item.get('username') != expected['username']
        or item.get('hermesHome') != expected['hermesHome']
        or item.get('globalHermesHome') != expected['globalHermesHome']
        or not isinstance(item.get('apiKey'), str)
        or len(item['apiKey']) < 16
        or len(item['apiKey']) > 2048
        or '\n' in item['apiKey']
        or not isinstance(item.get('cwd'), str)
        or not Path(item['cwd']).is_absolute()
        or not isinstance(item.get('projectId'), int)
        or item['projectId'] < 1
        or not isinstance(item.get('teamId'), int)
        or item['teamId'] < 1
        or not isinstance(item.get('planAgentId'), int)
        or item['planAgentId'] < 1
    ):
        raise RuntimeError('Hermes runner descriptor conflicts with its project')
    runtime = descriptor_runtime(item)
    if runtime in CLI_RUNTIMES:
        return cli_entry(runtime, username, item, home, slug, descriptor_path.stem, isolated)
    if isolated:
        # The profile belongs to the project's user; the sandbox links what Hermes needs
        # into it, and the project browser is reached through the gateway, not over CDP.
        return {
            'name': username,
            'apiKey': item['apiKey'],
            'cwd': item['cwd'],
            'env': {'HERMES_HOME': str(home)},
            'isolation': {
                'slug': slug,
                'profile': descriptor_path.stem,
                'agentId': item['planAgentId'],
            },
        }
    materialize_agent_home(home, global_home)
    return {
        'name': username,
        'apiKey': item['apiKey'],
        'cwd': item['cwd'],
        'env': {
            'HERMES_HOME': str(home),
            'HERMES_SHARED_AUTH_DIR': str(global_home / 'shared'),
            **project_browser_env(
                browser_root,
                slug,
                item['projectId'],
                item.get('browserCdpUrl'),
            ),
        },
        # The runner keeps the home's config.yaml the link to this one (policy.ts).
        'sharedConfig': str(global_home / 'config.yaml'),
    }


def materialize_agent_home(home: Path, global_home: Path) -> None:
    private_directory(home)
    config_source = global_home / 'config.yaml'
    config_metadata = config_source.lstat()
    if not stat.S_ISREG(config_metadata.st_mode) or stat.S_ISLNK(config_metadata.st_mode):
        raise RuntimeError('The global Hermes configuration is unavailable')
    for name in ('config.yaml', '.env'):
        source = global_home / name
        target = home / name
        if name == '.env' and not source.exists():
            continue
        source_metadata = source.lstat()
        if not stat.S_ISREG(source_metadata.st_mode) or stat.S_ISLNK(source_metadata.st_mode):
            raise RuntimeError('The global Hermes credential source is invalid')
        if target.exists() or target.is_symlink():
            if not target.is_symlink() or target.readlink() != source:
                # A file or another link took the place of the shared one, as a hand edit of
                # 2026-09-24 did. The runner puts the link back and keeps the file aside
                # (policy.ts ensureConfigLink), and Helena shows it on the agent; stopping
                # here would keep every agent from starting.
                print(
                    f'Hermes catalog: {home.name}/{name} is not the link to the shared one; '
                    'the runner restores it',
                    file=sys.stderr,
                )
            continue
        target.symlink_to(source)


def browser_harness_command() -> str | None:
    """The browser-harness MCP server's command in the shared configuration. The runner
    writes the server itself, pointed at each agent's own project browser."""
    from hermes_cli.config import load_config_readonly

    config = load_config_readonly()
    servers = config.get('mcp_servers') if isinstance(config, dict) else None
    entry = servers.get('browser-harness') if isinstance(servers, dict) else None
    command = entry.get('command') if isinstance(entry, dict) else None
    return command if isinstance(command, str) and command.startswith('/') else None


def write_runtime(
    template_path: Path,
    output_path: Path,
    descriptor_root: Path,
    global_home: Path,
    profile: dict[str, Any],
    browser_root: Path | None = None,
    plugin_root: Path = PLAN_PLUGIN_ROOT,
    problems: list[str] | None = None,
) -> tuple[str, int, int]:
    problems = [] if problems is None else problems
    payload = json.loads(template_path.read_text(encoding='utf-8'))
    payload['hermes'] = {**profile, 'plugins': plan_plugins(plugin_root)}
    provider, _default_model = configured_route()
    if provider:
        payload['provider'] = provider
    else:
        payload.pop('provider', None)
    payload['models'] = catalog_models(provider)

    home_key = os.environ.get('ITSAPLAN_API_KEY', '').strip()
    if len(home_key) < 16 or len(home_key) > 2048 or '\n' in home_key:
        raise RuntimeError('The Home runner credential is unavailable')
    isolated = isolation_enabled()
    if isolated:
        # Home runs as Home's user in a profile of its own (the migration copied its state
        # there); the global home holds the runner's keys and is nobody's profile.
        home = {
            'name': 'hermes-home-master',
            'apiKey': home_key,
            'cwd': HOME_WORKSPACE,
            'env': {'HERMES_HOME': str(global_home / 'profiles' / 'home')},
            'isolation': {'slug': 'home', 'profile': 'home', 'agentId': None},
        }
    else:
        # Home's own browser, the one Home's live view shows (project id 0).
        try:
            home_browser = project_browser_env(browser_root, 'home', 0)
        except RuntimeError as exc:
            problems.append(f'home: {exc}')
            home_browser = {}
        home = {
            'name': 'hermes-home-master',
            'apiKey': home_key,
            'env': {'HERMES_HOME': str(global_home), **home_browser},
        }
    agents = [home]
    for entry in descriptor_entries(descriptor_root, global_home, browser_root, isolated, problems):
        runtime = entry.pop('runtime', 'hermes')
        if runtime in CLI_RUNTIMES:
            # The runner's shared settings, without what only Hermes takes.
            shared_settings = {
                key: value
                for key, value in payload.items()
                if key not in ('agent', 'command', 'args', 'provider', 'hermes', 'models', 'outputFormat')
            }
            agents.append(
                {
                    **shared_settings,
                    **entry,
                    'agent': runtime,
                    'args': [],
                    'models': cli_models(runtime, payload['models']),
                    'env': {**payload.get('env', {}), **entry['env']},
                }
            )
            continue
        shared = entry.pop('sharedConfig', None)
        agents.append(
            {
                **payload,
                **entry,
                'env': {**payload.get('env', {}), **entry['env']},
                **({'hermes': {**payload['hermes'], 'sharedConfig': shared}} if shared else {}),
            }
        )
    if not isolated:
        for agent in agents:
            if agent.get('agent', payload.get('agent')) in CLI_RUNTIMES:
                continue
            link_plan_plugins(Path(agent['env']['HERMES_HOME']), plugin_root)
    payload.pop('apiKey', None)
    payload['agents'] = agents
    # What kept an agent from its runner; the runner reports it to Helena's health overview.
    payload['helenaProblems'] = problems

    private_directory(output_path.parent)
    fd, temporary = tempfile.mkstemp(prefix='.runner.', suffix='.json', dir=output_path.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, 'w', encoding='utf-8') as handle:
            json.dump(payload, handle, indent=2, ensure_ascii=False)
            handle.write('\n')
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, output_path)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
    return provider, len(payload['models']), len(agents)


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print('usage: volition-hermes-catalog.py TEMPLATE OUTPUT', file=sys.stderr)
        return 2
    global_home = Path(os.environ.get('HERMES_HOME', '')).resolve(strict=True)
    descriptor_root = Path(os.environ.get('HERMES_RUNNER_DESCRIPTOR_ROOT', str(global_home / 'run' / 'agents')))
    browser_root_value = os.environ.get(
        'HERMES_PROJECT_BROWSER_ROOT',
        '/var/lib/volition/project-browser/projects',
    ).strip()
    browser_root = Path(browser_root_value) if browser_root_value else None
    profile: dict[str, Any] = hermes_profile()
    require_browser_toolset(profile)
    require_approval_guard(hermes_approvals())
    harness = browser_harness_command()
    if harness:
        profile['browserHarness'] = harness
    problems: list[str] = []
    provider, count, agents = write_runtime(
        Path(argv[1]), Path(argv[2]), descriptor_root, global_home, profile, browser_root,
        problems=problems,
    )
    for problem in problems:
        print(f'Hermes catalog: left out {problem}', file=sys.stderr)
    print(f'Hermes catalog: provider={provider or "unconfigured"}, models={count}, agents={agents}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv))
