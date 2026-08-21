module.exports = {
  rootDir: __dirname,
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/integration/**/*.test.js', '<rootDir>/test/unit/**/*.test.js'],
  testTimeout: 15000,
  // These tests boot a real server per file; run files serially so ports
  // and the shared rate limiter don't collide across parallel workers.
  maxWorkers: 1,
  verbose: true,
};
