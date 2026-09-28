export interface CodingTask {
  id: string;
  language: 'typescript' | 'python';
  prompt: string;
  files: Record<string, string>;
  addedTest?: string;
}

const py = (source: string, tests: string): Record<string, string> => ({
  'solution.py': source,
  'test_solution.py': `import unittest\nfrom solution import *\n\nclass SolutionTest(unittest.TestCase):\n${tests}\n`,
});

export const CODING_TASKS: CodingTask[] = [
  {
    id: 'ts-clamp',
    language: 'typescript',
    prompt:
      'Fix clamp so values below the lower bound return the lower bound. Keep the public function name.',
    files: {
      'solution.ts':
        'export function clamp(value: number, low: number, high: number): number { return Math.min(low, Math.min(value, high)); }\n',
      'solution.test.ts':
        "import { test, expect } from 'bun:test';\nimport { clamp } from './solution';\ntest('bounds', () => { expect(clamp(-5, 0, 10)).toBe(0); expect(clamp(5, 0, 10)).toBe(5); expect(clamp(15, 0, 10)).toBe(10); });\n",
    },
  },
  {
    id: 'ts-unique',
    language: 'typescript',
    prompt:
      'Implement uniqueNames: remove duplicate names ignoring case, preserve the first spelling and input order.',
    files: {
      'solution.ts': 'export function uniqueNames(names: string[]): string[] { return names; }\n',
      'solution.test.ts':
        "import { test, expect } from 'bun:test';\nimport { uniqueNames } from './solution';\ntest('first spelling and order', () => expect(uniqueNames(['Ada', 'BOB', 'ada', 'Bob', 'Cy'])).toEqual(['Ada', 'BOB', 'Cy']));\ntest('empty', () => expect(uniqueNames([])).toEqual([]));\n",
    },
  },
  {
    id: 'ts-duration',
    language: 'typescript',
    prompt:
      'Implement parseDuration for strings like "2h 15m", "45m", and "1h". Return total minutes; throw on invalid input.',
    files: {
      'solution.ts':
        'export function parseDuration(text: string): number { throw new Error("todo"); }\n',
      'solution.test.ts':
        "import { test, expect } from 'bun:test';\nimport { parseDuration } from './solution';\ntest('valid durations', () => { expect(parseDuration('2h 15m')).toBe(135); expect(parseDuration('45m')).toBe(45); expect(parseDuration('1h')).toBe(60); });\ntest('invalid', () => expect(() => parseDuration('later')).toThrow());\n",
    },
  },
  {
    id: 'ts-slug',
    language: 'typescript',
    prompt:
      'Fix slugify so German umlauts become ae, oe, ue and ß becomes ss; trim separators and collapse runs of spaces or punctuation.',
    files: {
      'solution.ts':
        "export function slugify(text: string): string { return text.toLowerCase().replace(/\\s+/g, '-'); }\n",
      'solution.test.ts':
        "import { test, expect } from 'bun:test';\nimport { slugify } from './solution';\ntest('German and separators', () => { expect(slugify(' Äpfel & Öl! ')).toBe('aepfel-oel'); expect(slugify('Straße -- Neu')).toBe('strasse-neu'); });\n",
    },
  },
  {
    id: 'ts-total',
    language: 'typescript',
    prompt:
      'Refactor invoiceTotal to avoid mutating input and compute a rounded cent total after discounts. Keep the exported signature.',
    files: {
      'solution.ts':
        'export function invoiceTotal(lines: { price: number; quantity: number; discount: number }[]): number { let total = 0; for (const line of lines) { line.price -= line.discount; total += line.price * line.quantity; } return total; }\n',
      'solution.test.ts':
        "import { test, expect } from 'bun:test';\nimport { invoiceTotal } from './solution';\ntest('total and immutable input', () => { const lines = [{ price: 2.35, quantity: 3, discount: 0.1 }]; expect(invoiceTotal(lines)).toBe(6.75); expect(lines[0]?.price).toBe(2.35); });\n",
    },
  },
  {
    id: 'ts-add-test',
    language: 'typescript',
    prompt:
      'Add solution.test.ts with Bun tests for isPrime covering 0, 1, 2, 9, and 11. Do not change the implementation.',
    files: {
      'solution.ts':
        'export function isPrime(n: number): boolean { if (n < 2) return false; for (let i = 2; i * i <= n; i++) if (n % i === 0) return false; return true; }\n',
    },
    addedTest: 'solution.test.ts',
  },
  {
    id: 'py-median',
    language: 'python',
    prompt:
      'Fix median to return the middle value after sorting, and the average of the two middle values for even lists. Keep ValueError for empty lists.',
    files: py(
      'def median(values):\n    if not values: raise ValueError("empty")\n    return values[len(values) // 2]\n',
      '    def test_unsorted(self):\n        self.assertEqual(median([9, 1, 5]), 5)\n        self.assertEqual(median([10, 2, 4, 6]), 5)\n    def test_empty(self):\n        with self.assertRaises(ValueError): median([])',
    ),
  },
  {
    id: 'py-csv',
    language: 'python',
    prompt:
      'Implement parse_csv_line to handle quoted commas and escaped double quotes. Return a list of strings.',
    files: py(
      'def parse_csv_line(line):\n    return line.split(",")\n',
      '    def test_quoted(self):\n        self.assertEqual(parse_csv_line(\'a,"b,c","d""e"\'), ["a", "b,c", \'d"e\'])\n    def test_plain(self):\n        self.assertEqual(parse_csv_line("a,b"), ["a", "b"])',
    ),
  },
  {
    id: 'py-subtotal',
    language: 'python',
    prompt:
      'Refactor subtotal to handle either list or tuple inputs without changing them. Ignore items with quantity zero and reject negative quantities.',
    files: py(
      'def subtotal(items):\n    total = 0\n    for item in items:\n        total += item["price"] * item["quantity"]\n    return total\n',
      '    def test_values(self):\n        items = ({"price": 4, "quantity": 2}, {"price": 7, "quantity": 0})\n        self.assertEqual(subtotal(items), 8)\n        self.assertEqual(items[0]["price"], 4)\n    def test_negative(self):\n        with self.assertRaises(ValueError): subtotal([{"price": 2, "quantity": -1}])',
    ),
  },
  {
    id: 'py-size',
    language: 'python',
    prompt:
      'Fix parse_size so decimal KB, MB, and GB suffixes are case insensitive and return bytes. A bare integer means bytes.',
    files: py(
      'def parse_size(text):\n    return int(text)\n',
      '    def test_units(self):\n        self.assertEqual(parse_size("2KB"), 2000)\n        self.assertEqual(parse_size("1.5mb"), 1500000)\n        self.assertEqual(parse_size("3GB"), 3000000000)\n        self.assertEqual(parse_size("42"), 42)',
    ),
  },
  {
    id: 'py-add-test',
    language: 'python',
    prompt:
      'Add test_solution.py with unittest cases for normalize_email covering surrounding spaces, uppercase domain, and an invalid address. Keep the implementation.',
    files: {
      'solution.py':
        'def normalize_email(value):\n    value = value.strip().lower()\n    if value.count("@") != 1 or not all(value.split("@")):\n        raise ValueError("invalid email")\n    return value\n',
    },
    addedTest: 'test_solution.py',
  },
  {
    id: 'py-group',
    language: 'python',
    prompt:
      'Implement group_by_status: return a dict mapping each status to the IDs in input order. Do not mutate the input rows.',
    files: py(
      'def group_by_status(rows):\n    return {}\n',
      '    def test_groups(self):\n        rows = [{"id": 1, "status": "open"}, {"id": 2, "status": "done"}, {"id": 3, "status": "open"}]\n        self.assertEqual(group_by_status(rows), {"open": [1, 3], "done": [2]})\n        self.assertEqual(rows[0]["status"], "open")',
    ),
  },
];
