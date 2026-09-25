import { config } from '@repo/eslint-config/base';

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...config,
  {
    files: ['src/**/*.ts'],
    ignores: ['src/shared/schemas.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='t'][callee.property.name='UnionEnum']",
          message:
            "Use oneOf from '#shared/schemas': t.UnionEnum defaults to its first value, which Elysia fills into a request field that is left out.",
        },
      ],
    },
  },
];
