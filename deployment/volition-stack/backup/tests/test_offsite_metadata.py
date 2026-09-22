#!/usr/bin/env python3
import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from offsite_metadata import metadata_name_matches


class MetadataNameTests(unittest.TestCase):
    expected = 'volition-restic-20260921T124736Z.tar'
    marker = '0123456789abcdef'

    def wrapped(self, name=None, end_marker=None):
        return '\n'.join([
            f'<<<EXTERNAL_UNTRUSTED_CONTENT id="{self.marker}">>>',
            self.expected if name is None else name,
            f'<<<END_EXTERNAL_UNTRUSTED_CONTENT id="{end_marker or self.marker}">>>',
        ])

    def current_gog_wrapped(self, name=None):
        return '\n'.join([
            f'<<<EXTERNAL_UNTRUSTED_CONTENT id="{self.marker}">>>',
            'Source: google_api',
            '---',
            self.expected if name is None else name,
            f'<<<END_EXTERNAL_UNTRUSTED_CONTENT id="{self.marker}">>>',
        ])

    def test_accepts_raw_expected_name(self):
        self.assertTrue(metadata_name_matches(self.expected, self.expected))

    def test_accepts_exact_three_line_wrapper(self):
        self.assertTrue(metadata_name_matches(self.wrapped(), self.expected))

    def test_accepts_exact_current_gog_wrapper(self):
        self.assertTrue(metadata_name_matches(self.current_gog_wrapped(), self.expected))

    def test_rejects_mismatched_name_and_marker(self):
        self.assertFalse(metadata_name_matches(self.wrapped('other.tar'), self.expected))
        self.assertFalse(metadata_name_matches(self.wrapped(end_marker='fedcba9876543210'), self.expected))

    def test_rejects_extra_content_or_bad_source(self):
        self.assertFalse(metadata_name_matches('prefix\n' + self.wrapped(), self.expected))
        self.assertFalse(metadata_name_matches(self.wrapped() + '\nsuffix', self.expected))
        self.assertFalse(metadata_name_matches(self.current_gog_wrapped().replace('google_api', 'other'), self.expected))

    def test_rejects_non_strings_and_empty_expected(self):
        self.assertFalse(metadata_name_matches(None, self.expected))
        self.assertFalse(metadata_name_matches(self.expected, ''))


if __name__ == '__main__':
    unittest.main()
