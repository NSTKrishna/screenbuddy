import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'coverage/**', 'test-results/**', 'playwright-report/**'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }],
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
      // SECURITY.md §6: no code path from anything to a shell or a code evaluator.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'child_process', message: 'Shelling out is not allowed (SECURITY.md §6).' },
            {
              name: 'node:child_process',
              message: 'Shelling out is not allowed (SECURITY.md §6).',
            },
            { name: 'vm', message: 'Code evaluation is not allowed (SECURITY.md §6).' },
            { name: 'node:vm', message: 'Code evaluation is not allowed (SECURITY.md §6).' },
          ],
        },
      ],
      'no-eval': 'error',
      'no-implied-eval': 'off',
      '@typescript-eslint/no-implied-eval': 'error',
      'no-new-func': 'error',
    },
  },
  {
    files: ['src/main/**', 'src/preload/**', '*.config.ts', 'tests/e2e/**', 'tests/unit/main/**'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}', 'tests/unit/renderer/**'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Renderers talk to main only through window.screenBuddy.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['electron', 'node:*'], message: 'Renderers must use the preload bridge.' },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node, parserOptions: { projectService: false } },
  },
)
