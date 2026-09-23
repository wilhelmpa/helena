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


def descriptor_entries(root: Path, global_home: Path, browser_root: Path | None = None) -> list[dict[str, Any]]:
    private_directory(root)
    entries: list[dict[str, Any]] = []
    global_home = global_home.resolve(strict=True)
    profiles_root = (global_home / 'profiles').resolve(strict=False)
    for descriptor_path in sorted(root.glob('*.json')):
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
        materialize_agent_home(home, global_home)
        entries.append(
            {
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
            }
        )
    return entries


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
                raise RuntimeError('The isolated Hermes home conflicts with its global provider reference')
            continue
        target.symlink_to(source)


def write_runtime(
    template_path: Path,
    output_path: Path,
    descriptor_root: Path,
    global_home: Path,
    profile: dict[str, list[str]],
    browser_root: Path | None = None,
    plugin_root: Path = PLAN_PLUGIN_ROOT,
) -> tuple[str, int, int]:
    payload = json.loads(template_path.read_text(encoding='utf-8'))
    payload['hermes'] = profile
    provider, _default_model = configured_route()
    if provider:
        payload['provider'] = provider
    else:
        payload.pop('provider', None)
    payload['models'] = catalog_models(provider)

    home_key = os.environ.get('ITSAPLAN_API_KEY', '').strip()
    if len(home_key) < 16 or len(home_key) > 2048 or '\n' in home_key:
        raise RuntimeError('The Home runner credential is unavailable')
    home = {
        'name': 'hermes-home-master',
        'apiKey': home_key,
        'env': {'HERMES_HOME': str(global_home)},
    }
    agents = [home]
    for entry in descriptor_entries(descriptor_root, global_home, browser_root):
        agents.append({**payload, **entry, 'env': {**payload.get('env', {}), **entry['env']}})
    for agent in agents:
        link_plan_plugins(Path(agent['env']['HERMES_HOME']), plugin_root)
    payload.pop('apiKey', None)
    payload['agents'] = agents

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
    profile = hermes_profile()
    require_browser_toolset(profile)
    require_approval_guard(hermes_approvals())
    provider, count, agents = write_runtime(
        Path(argv[1]), Path(argv[2]), descriptor_root, global_home, profile, browser_root
    )
    print(f'Hermes catalog: provider={provider or "unconfigured"}, models={count}, agents={agents}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv))
