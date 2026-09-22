#!/usr/bin/env python3
"""Strict comparisons for provider metadata wrapped by gog safety guards."""

import re


_START = re.compile(r'<<<EXTERNAL_UNTRUSTED_CONTENT id="([0-9a-f]{16})">>>')
_END = re.compile(r'<<<END_EXTERNAL_UNTRUSTED_CONTENT id="([0-9a-f]{16})">>>')


def metadata_name_matches(value: object, expected: str) -> bool:
    """Accept a raw name or an exact gog wrapper carrying only that name."""
    if not isinstance(value, str) or not isinstance(expected, str) or not expected:
        return False
    if value == expected:
        return True
    lines = value.splitlines()
    if len(lines) == 3:
        start, actual, end = lines
    elif len(lines) == 5 and lines[1:3] == ['Source: google_api', '---']:
        start, actual, end = lines[0], lines[3], lines[4]
    else:
        return False
    start_match = _START.fullmatch(start)
    end_match = _END.fullmatch(end)
    return bool(
        start_match
        and end_match
        and start_match.group(1) == end_match.group(1)
        and actual == expected
    )
