import coreWebVitals from 'eslint-config-next/core-web-vitals'
import typescript from 'eslint-config-next/typescript'

const config = [
  ...coreWebVitals,
  ...typescript,
  {
    // Generated coverage reports and local agent worktrees are not source code
    ignores: ['coverage/**', '.claude/**'],
  },
  {
    rules: {
      // ignoreRestSiblings: destructuring to omit keys (`const { a, ...rest }`)
      // is intentional; argsIgnorePattern: `_`-prefixed params are declared-unused
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { ignoreRestSiblings: true, argsIgnorePattern: '^_' },
      ],
    },
  },
]

export default config
