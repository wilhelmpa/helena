#!/usr/bin/env python3
"""Render the dev instance env file from the live Plan env.

Reads the live env file and the local-owner env file, writes the dev env to stdout and
never prints anything else. Usage: render-env.py LIVE_ENV OWNER_ENV DEV_TOKEN
"""
import sys
from urllib.parse import urlsplit, urlunsplit

DEV_ORIGIN = 'http://localhost:8090'
DEV_DATABASE = 'itsaplan_dev'
DEV_STORAGE = '/var/lib/volition/plan-dev/storage'
OVERRIDES = {
    'APP_URL': DEV_ORIGIN,
    'API_URL': f'{DEV_ORIGIN}/backend',
    'STORAGE_ROOT': DEV_STORAGE,
    'SERVICE_URL_API': 'http://127.0.0.1:3100',
    'API_HOST': '127.0.0.1',
    'API_PORT': '3100',
    'NODE_ENV': 'development',
    'PLAN_CONTROL_TOKEN_FILE': '/etc/volition/dev/plan-control.token',
    # The dev database is a copy of the live one, with the live engine's pending workflows,
    # schedules and runs. An engine on it would run them a second time (webhooks included),
    # so the dev API runs without the engine unless it is switched on by hand.
    'HELENA_ENGINE': 'off',
    'BROWSER_URL': f'{DEV_ORIGIN}/browser/projects/home/vnc.html?autoconnect=1&resize=remote'
    '&path=browser%2Fprojects%2Fhome%2Fwebsockify',
}
# Most tool frames belong to the live instance only; the browser and the control plane
# are set above. The engine's own database and executor default to the dev database and
# the host, never the live ones.
DROP = {
    'TERMINAL_URL',
    'CODE_URL',
    'HERMES_URL',
    'HERMES_COORDINATOR_ID',
    'HELENA_ENGINE_DATABASE_URL',
    'HELENA_ENGINE_EXECUTOR_ID',
}
# Left over from Mastra, which the Helena engine replaced.
DROP_PREFIXES = ('MASTRA_', 'PLAN_MASTRA_')


def unquote(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in '"\'':
        return value[1:-1]
    return value


def parse(path: str) -> dict[str, str]:
    values: dict[str, str] = {}
    with open(path, encoding='utf-8') as handle:
        for raw in handle:
            line = raw.rstrip('\n')
            if not line.strip() or line.lstrip().startswith('#') or '=' not in line:
                continue
            key, value = line.split('=', 1)
            values[key.strip()] = unquote(value.strip())
    return values


def main() -> None:
    live_env, owner_env, token = sys.argv[1:4]
    if len(token) < 32:
        raise SystemExit('dev token is too short')
    env = parse(live_env)
    database = urlsplit(env['DATABASE_URL'])
    env['DATABASE_URL'] = urlunsplit(database._replace(path=f'/{DEV_DATABASE}'))
    for key in list(env):
        if key in DROP or key.startswith(DROP_PREFIXES):
            del env[key]
    env.update(OVERRIDES)
    owner = parse(owner_env)
    env['LOCAL_SINGLE_USER_EMAIL'] = owner['LOCAL_SINGLE_USER_EMAIL']
    env['LOCAL_SINGLE_USER_TOKEN'] = token
    env['LOCAL_SINGLE_USER_ORIGIN'] = DEV_ORIGIN
    env['LOCAL_SINGLE_USER_API_URL'] = 'http://127.0.0.1:3100/api/auth/sign-in/local-owner'
    for key, value in env.items():
        sys.stdout.write(f'{key}={value}\n')


if __name__ == '__main__':
    main()
