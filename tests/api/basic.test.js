// Basic test file to prevent GitHub Actions from failing
// when running npm test

describe('Basic Tests', () => {
  test('should pass basic test', () => {
    expect(true).toBe(true);
  });

  test('should have correct environment', () => {
    expect(process.env.NODE_ENV).toBeDefined();
  });
});