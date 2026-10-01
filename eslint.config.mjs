import avalonBase from '@avalon-vanguard/config/eslint';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'docs/**'],
  },
  // @eslint/js recommended + typescript-eslint recommended, shared across avalon-vanguard
  avalonBase,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'warn',
    },
  },
  {
    files: ['**/*.test.ts', 'src/example.ts'],
    rules: {
      'no-console': 'off',
    },
  }
);
