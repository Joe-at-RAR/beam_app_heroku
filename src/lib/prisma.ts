import { PrismaClient } from '@prisma/client';
import { fieldEncryptionExtension } from 'prisma-field-encryption';

// Define the type for the extended client
export type ExtendedPrismaClient = ReturnType<typeof createExtendedPrismaClient>;

// Declare the global variable type
declare global {
  // eslint-disable-next-line no-var
  var __prisma: ExtendedPrismaClient | undefined;
}

function createExtendedPrismaClient() {
  console.log('[PRISMA INIT] Creating new PrismaClient instance with field encryption...');
  // Retrieve the encryption key, ensuring it's defined
  const encryptionKey = process.env['PRISMA_FIELD_ENCRYPTION_KEY'];
  if (!encryptionKey) {
    console.warn('[PRISMA INIT] WARNING: PRISMA_FIELD_ENCRYPTION_KEY is not set. Field encryption will not work!');
    // Optionally, throw an error if encryption is mandatory:
    // throw new Error('PRISMA_FIELD_ENCRYPTION_KEY environment variable is required.');
  }

  const client = new PrismaClient({
      // log: ['query', 'info', 'warn', 'error'], // Optional logging
  }).$extends(
      fieldEncryptionExtension({
          encryptionKey: encryptionKey, // Use the retrieved key
          // Add any other specific options for prisma-field-encryption here
      })
  );
  return client;
}

// Initialize the client using the singleton pattern
const prisma = global.__prisma ?? createExtendedPrismaClient();

// Use bracket notation for process.env access
if (process.env['NODE_ENV'] !== 'production') { 
  global.__prisma = prisma;
}

// Immediately attempt connection (optional, can be done in adapter initialize)
// Using an IIAFE (Immediately Invoked Async Function Expression) to handle top-level await need
(async () => {
  try {
    // Check if connection needs testing or rely on lazy connect
    // await prisma.$connect(); 
    // console.log('[PRISMA INIT] Prisma client connected successfully.');
    // Alternatively, run a simple query to test
    await prisma.$queryRaw`SELECT 1`;
    console.log('[PRISMA INIT] Prisma client connection verified.');
  } catch (error) {
    console.error('[PRISMA INIT] Failed to connect or verify Prisma client:', error);
    // Optional: exit process if connection is critical on startup
    // process.exit(1);
  }
})();

export default prisma; 