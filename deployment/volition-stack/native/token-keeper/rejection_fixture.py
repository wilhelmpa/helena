"""Emit the real keeper's public report after a fake 401, using only temporary stores."""
import json
import sys
from unittest import mock

from test_helena_token_keeper import KeeperLogic, Row, ms


def rejection_report():
    fixture = KeeperLogic()
    fixture.setUp()
    try:
        fixture.hermes.add('openai-codex', Row('fixture-codex', 'fake-access', 'fake-refresh', ms(9 * 86400)))
        fixture.hermes.probe_status = 401
        report = fixture.keeper().tick(refresh=True)
        assert fixture.hermes.rows['openai-codex'][0].last_status == 'dead'
        assert fixture.hermes.refreshed == []
        return report
    finally:
        fixture.tearDown()


def hermes_rejection_report():
    from test_token_keeper_hermes import HERMES, KEEPER, KeeperWithHermes
    if not HERMES:
        raise RuntimeError('Installed Hermes must be importable for --hermes')
    fixture = KeeperWithHermes()
    fixture.setUp()
    try:
        fixture.root.codex(9 * 86400).write()
        with mock.patch.object(KEEPER.Hermes, 'probe', return_value=401):
            report = fixture.tick()
        assert fixture.login(report, 'openai-codex')['state'] == 'invalid'
        assert fixture.codex_calls == []
        return report
    finally:
        fixture.tearDown()


if __name__ == '__main__':
    print(json.dumps(hermes_rejection_report() if '--hermes' in sys.argv else rejection_report()))
