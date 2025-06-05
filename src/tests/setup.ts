// Minimal Jest setup for tests

// Set test environment variables using bracket notation to avoid TypeScript warnings
process.env['NODE_ENV'] = 'test';
process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';
process.env['PRISMA_URL'] = 'postgresql://test:test@localhost:5432/test';

export {}; 