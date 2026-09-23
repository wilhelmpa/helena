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


def model_name(model_id: str) -> str:
    leaf = model_id.rsplit('/', 1)[-1]
    words = re.split(r'[-_]+', leaf)
    rendered: list[str] = []
    for word in words:
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
        slug = descriptor_path.stem
        username = f'hermes-{slug}-coordinator'
        home = profiles_root / slug
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
) -> tuple[str, int, int]:
    payload = json.loads(template_path.read_text(encoding='utf-8'))
    payload['hermes'] = profile
    provider, _default_model = configured_route()
    if provider:
        payload['provider'] = provider
        payload['models'] = discover_catalog(provider)
    else:
        payload.pop('provider', None)
        payload['models'] = []

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
    provider, count, agents = write_runtime(
        Path(argv[1]), Path(argv[2]), descriptor_root, global_home, profile, browser_root
    )
    print(f'Hermes catalog: provider={provider or "unconfigured"}, models={count}, agents={agents}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv))
