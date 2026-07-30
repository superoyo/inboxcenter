// ESLint flat config — ครอบเฉพาะโค้ดใหม่ (TypeScript ใน packages/ และ apps/)
// โค้ดเดิม (server.js, lib/*.js, public/*) ยังไม่ lint จนกว่าจะย้ายเสร็จตามแผน
// ดู docs/REFACTOR-PLAN.md
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    // ยังไม่ตรวจโค้ดเดิม + ผลลัพธ์ build
    ignores: [
      'node_modules/**',
      '**/dist/**',
      'public/**',
      'examples/**',
      'server.js',
      'seed-demo.js',
      'lib/**',
      'data/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
    },
  },
  prettier,
);
