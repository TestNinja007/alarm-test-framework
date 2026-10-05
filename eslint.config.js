import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // k6 scripts run in k6's own runtime, not Node, and import from k6/* modules
  // that resolve at run time rather than on disk.
  { ignores: ['node_modules', 'playwright-report', 'test-results', 'k6'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // A test that only logs is a test nobody reads the output of.
      'no-console': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      // Playwright fixtures that use none of the others still have to
      // declare the destructured first argument.
      'no-empty-pattern': 'off',
    },
  },
);
