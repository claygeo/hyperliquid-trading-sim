/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.json',
        useESM: false,
      },
    ],
  },
  collectCoverageFrom: [
    'src/services/trading/**/*.ts',
    'src/utils/**/*.ts',
    'src/research/**/*.ts',
    '!src/research/cli.ts',
    '!src/**/*.d.ts',
  ],
  coverageThreshold: {
    'src/research/': {
      branches: 80,
      functions: 90,
      lines: 90,
      statements: 90,
    },
  },
};

module.exports = config;
