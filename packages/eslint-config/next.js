import globals from 'globals';
import pluginNext from '@next/eslint-plugin-next';
import pluginReact from 'eslint-plugin-react';
import pluginReactHooks from 'eslint-plugin-react-hooks';
import pluginJsxA11y from 'eslint-plugin-jsx-a11y';
import { config as baseConfig } from './base.js';

/**
 * Shared ESLint flat config for Next.js apps.
 * Extends the base config with React, React Hooks and Next.js rules.
 *
 * @type {import("eslint").Linter.Config[]}
 */
export const nextJsConfig = [
  ...baseConfig,
  {
    // Next.js generated type file, not meant to be linted.
    ignores: ['next-env.d.ts'],
  },
  {
    ...pluginReact.configs.flat.recommended,
    languageOptions: {
      ...pluginReact.configs.flat.recommended.languageOptions,
      globals: { ...globals.serviceworker, ...globals.browser },
    },
    settings: { react: { version: '19' } },
  },
  // React Hooks 7: besides the rules of hooks, the React Compiler's checks
  // (set-state-in-effect, refs, purity, immutability, …), which catch the class of the
  // 2026-09-24 "Maximum update depth" incident before it ships.
  {
    plugins: { 'react-hooks': pluginReactHooks },
    rules: { ...pluginReactHooks.configs.recommended.rules },
  },
  // WAI-ARIA and HTML accessibility checks on JSX.
  pluginJsxA11y.flatConfigs.recommended,
  {
    plugins: { '@next/next': pluginNext },
    rules: {
      ...pluginNext.configs.recommended.rules,
      ...pluginNext.configs['core-web-vitals'].rules,
    },
  },
  {
    rules: {
      // React 17+ / Next.js: no need to import React into scope.
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
    },
  },
];
