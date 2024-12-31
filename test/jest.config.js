module.exports = {
  preset: "ts-jest",

  testEnvironment: "jsdom",
  testEnvironment: "node",
  setupFiles: ["fake-indexeddb/auto"],

  testMatch: ["**/test/**/*.test.ts"],
  transform: {
    "^.+\\.(ts|tsx)$": "ts-jest",
  },
  collectCoverage: true,
  collectCoverageFrom: ["src/**/*.ts"],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
};
