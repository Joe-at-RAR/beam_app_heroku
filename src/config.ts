import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from server/.env file
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Development mode check
const isDevelopment = process.env['NODE_ENV'] === 'development';
const isProduction = process.env['NODE_ENV'] === 'production';
const isTest = process.env['NODE_ENV'] === 'test';

////////////////////////////////////////////////////////////////
// Environment variable validation schema
////////////////////////////////////////////////////////////////

const envSchemaBase = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  
  // Storage type - will be refined by OPERATING_MODE
  STORAGE_TYPE: z.enum(['LOCAL', 'POSTGRES_PRISMA', 'MYSQL']).default('LOCAL'),
  OPERATING_MODE: z.enum(['LOCAL', 'VSRX', 'SILKNOTE']).default('LOCAL'),
  
  // Required environment variables with no defaults
  VITE_BASE_URL: z.string({
    required_error: "VITE_BASE_URL is required (e.g., 'localhost' or 'yourdomain.com')"
  }),
  // VITE_PORT is for Vite's dev server, or can inform the SERVER_PORT for local dev.
  VITE_PORT: z.string().optional().default('3001').transform(Number), 
  // SERVER_PORT is what the backend will try to listen on if process.env.PORT (from Heroku) isn't available.
  SERVER_PORT: z.string().optional().default('3000').transform(Number),
  
  // Optional CORS_ORIGIN - can be a string
  CORS_ORIGIN: z.string().optional(),
  
  // Azure Search - Optional in development
  AZURE_SEARCH_ENDPOINT: isDevelopment ? z.string().optional() : z.string(),
  AZURE_SEARCH_INDEX: isDevelopment ? z.string().optional() : z.string(),
  AZURE_SEARCH_KEY: isDevelopment ? z.string().optional() : z.string(),
  
  // Azure OpenAI - Optional in development
  AZURE_OPENAI_KEY: isDevelopment ? z.string().optional() : z.string(),
  AZURE_OPENAI_ENDPOINT: isDevelopment ? z.string().optional() : z.string(),
  AZURE_OPENAI_DEPLOYMENT: isDevelopment ? z.string().optional() : z.string(),
  AZURE_OPENAI_RESOURCE: isDevelopment ? z.string().optional() : z.string(),
  
  // Azure Document Intelligence - Optional in development
  AZURE_DOCUMENT_KEY: isDevelopment ? z.string().optional() : z.string(),
  AZURE_DOCUMENT_ENDPOINT: isDevelopment ? z.string().optional() : z.string(),
  SHOW_TEST_HARNESS: z.boolean().default(false),

  // Conditionally required Azure Storage Connection String
  AZURE_STORAGE_CONNECTION_STRING: z.string().optional(),
  AZURE_STORAGE_CONTAINER_NAME: z.string().default('documents'),
});

// Refine schema based on OPERATING_MODE
const envSchema = envSchemaBase.superRefine((data, ctx) => {
  if (data.OPERATING_MODE === 'SILKNOTE' && !data.AZURE_STORAGE_CONNECTION_STRING) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'AZURE_STORAGE_CONNECTION_STRING is required when OPERATING_MODE is SILKNOTE',
      path: ['AZURE_STORAGE_CONNECTION_STRING'],
    });
  }
  // If SILKNOTE mode implies Postgres, ensure STORAGE_TYPE reflects that.
  // This example assumes SILKNOTE uses POSTGRES_PRISMA. Adjust if different.
  if (data.OPERATING_MODE === 'SILKNOTE') {
    data.STORAGE_TYPE = 'POSTGRES_PRISMA';
  } else if (data.OPERATING_MODE === 'LOCAL') {
    data.STORAGE_TYPE = 'LOCAL';
  }
  // Add other mode-specific refinements if necessary
});

// Parse and validate environment variables
const parsedEnv = envSchema.parse(process.env);

// Determine the actual port the server will listen on
let actualServerPort: number;
if (isTest) {
  actualServerPort = 4001; // Fixed port for testing
} else if (process.env['PORT']) {
  actualServerPort = Number(process.env['PORT']); // Heroku-provided port
} else {
  actualServerPort = parsedEnv.SERVER_PORT; // From .env or default for local dev
}

// Determine protocol and public base URL
const protocol = (parsedEnv.VITE_BASE_URL === 'localhost' || isDevelopment && !isProduction) ? 'http' : 'https';
const wsProtocol = (parsedEnv.VITE_BASE_URL === 'localhost' || isDevelopment && !isProduction) ? 'ws' : 'wss';

let publicHost = parsedEnv.VITE_BASE_URL;
let publicPortSegment = `:${actualServerPort}`; // Start with the actual server port

if (isProduction) {
  // For production (e.g., Heroku), if VITE_BASE_URL is a domain, it usually implies standard ports.
  // Heroku handles port mapping, so we typically don't include the internal `actualServerPort` (e.g. 3000 if that was default)
  // in the public URL if VITE_BASE_URL is the Heroku domain.
  // If VITE_BASE_URL is just 'localhost' even in prod (unlikely for true Heroku), this logic might need adjustment.
  // Assuming VITE_BASE_URL is the public domain name on Heroku.
  publicPortSegment = ''; // Standard ports 80/443 are implied
} else if (isDevelopment || parsedEnv.VITE_BASE_URL === 'localhost') {
  // For local development, use the VITE_PORT for the public URL if it's different from the server port,
  // as Vite dev server might run on a different port than the backend.
  // However, if they are the same or VITE_PORT is what the server uses, actualServerPort is fine.
  // Using actualServerPort which defaults to SERVER_PORT (e.g. 3000) or VITE_PORT (e.g. 3001) if .env is set.
  // If your Vite dev server and backend server run on *different* ports locally, and you want
  // publicBaseUrl to point to Vite, use parsedEnv.VITE_PORT here.
  // For simplicity, we'll assume publicBaseUrl reflects where the API is served.
   publicPortSegment = `:${actualServerPort}`;
}


const publicBaseUrl = `${protocol}://${publicHost}${publicPortSegment}`;
const wsBaseUrl = `${wsProtocol}://${publicHost}${publicPortSegment}`;

// Override port in test mode to ensure consistency
const env = {
  ...parsedEnv,
  PORT: actualServerPort, // This is the port the server will *actually* listen on
  // Support multiple origins based on environment
  CORS_ORIGIN: parsedEnv.CORS_ORIGIN || 
    (isDevelopment 
      ? ['http://localhost:3000', `http://localhost:${parsedEnv.VITE_PORT}`, publicBaseUrl].filter(Boolean).reduce((acc, curr) => acc.includes(curr) ? acc : [...acc, curr], [] as string[])
      : publicBaseUrl),
  PUBLIC_BASE_URL: publicBaseUrl,
  WS_BASE_URL: wsBaseUrl,
  // Add storage type
  STORAGE_TYPE: parsedEnv.STORAGE_TYPE,
  AZURE_STORAGE_CONTAINER_NAME: parsedEnv.AZURE_STORAGE_CONTAINER_NAME,
};


////////////////////////////////////////////////////////////////
// Configuration object
////////////////////////////////////////////////////////////////

const config: Config = {
  azure: {
    search: {
      endpoint: env.AZURE_SEARCH_ENDPOINT || '',
      indexName: env.AZURE_SEARCH_INDEX || '',
      apiKey: env.AZURE_SEARCH_KEY || ''
    },
    azureOpenAI: {
      key: env.AZURE_OPENAI_KEY || '',
      endpoint: env.AZURE_OPENAI_ENDPOINT || '',
      deployment: env.AZURE_OPENAI_DEPLOYMENT || '',
      resource: env.AZURE_OPENAI_RESOURCE || ''
    },    
    azureOpenAILogic: {
      key: env.AZURE_OPENAI_KEY || '',
      endpoint: env.AZURE_OPENAI_ENDPOINT || '',
      deployment: env.AZURE_OPENAI_DEPLOYMENT || '',
      resource: env.AZURE_OPENAI_RESOURCE || ''
    },
    documentIntelligence: {
      key: env.AZURE_DOCUMENT_KEY || '',
      endpoint: env.AZURE_DOCUMENT_ENDPOINT || ''
    }
  },
  server: {
    port: env.PORT, // Use the reliably determined env.PORT
    nodeEnv: env.NODE_ENV,
    isDevelopment: env.NODE_ENV === 'development',
    isProduction: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
    corsOrigin: env.CORS_ORIGIN,
    publicBaseUrl: env.PUBLIC_BASE_URL,
    wsBaseUrl: env.WS_BASE_URL,
    baseUrl: env.VITE_BASE_URL // This remains the raw base URL/host
  },
  processing: {
    maxFileSize: 50 * 1024 * 1024, // 50MB
    maxFiles: 500, // Maximum 500 files per batch
    allowedTypes: ['application/pdf'],
    tempDir: path.join(process.cwd(), 'server', 'temp'),
    outputDir: path.join(process.cwd(), 'server', 'data', 'documents')
  },
  storage: {
    type: env.STORAGE_TYPE,
    azureContainerName: env.AZURE_STORAGE_CONTAINER_NAME,
    // Additional storage-specific configuration can be added here
  },
  errors: {
    serverError: 'An unexpected error occurred. Please try again later.',
    invalidInput: 'Invalid input provided.',
    documentProcessingFailed: 'Document processing failed.',
    queryFailed: 'Query processing failed.',
    invalidFileType: 'Invalid file type. Only PDF, JPEG, and PNG files are allowed.',
    missingFile: 'No file was provided.',
    processingError: 'Error processing document.',
    fileTooLarge: 'File size exceeds the maximum limit.',
    tooManyFiles: 'Too many files. Maximum allowed is 10.'
  }
};

////////////////////////////////////////////////////////////////
// Types
////////////////////////////////////////////////////////////////

// Type definitions
interface AzureSearchConfig {
  endpoint: string;
  indexName: string;
  apiKey: string;
}

interface AzureOpenAIConfig {
  key: string;
  endpoint: string;
  deployment: string;
  resource: string;
}

interface AzureDocumentIntelligenceConfig {
  key: string;
  endpoint: string;
}

interface AzureConfig {
  search: AzureSearchConfig;
  azureOpenAI: AzureOpenAIConfig;
  azureOpenAILogic: AzureOpenAIConfig;
  documentIntelligence: AzureDocumentIntelligenceConfig;
}

interface ServerConfig {
  port: number;
  nodeEnv: 'development' | 'production' | 'test';
  isDevelopment: boolean;
  isProduction: boolean;
  isTest: boolean;
  corsOrigin: string | string[];
  publicBaseUrl: string;
  wsBaseUrl: string;
  baseUrl: string;
}

interface ProcessingConfig {
  maxFileSize: number;
  maxFiles: number;
  allowedTypes: string[];
  tempDir: string;
  outputDir: string;
}

interface ErrorMessages {
  serverError: string;
  invalidInput: string;
  documentProcessingFailed: string;
  queryFailed: string;
  invalidFileType: string;
  missingFile: string;
  processingError: string;
  fileTooLarge: string;
  tooManyFiles: string;
}

interface StorageConfig {
  type: 'LOCAL' | 'POSTGRES_PRISMA' | 'MYSQL';
  azureContainerName: string;
  // Additional storage-specific configuration can be added here
}

interface Config {
  azure: AzureConfig;
  server: ServerConfig;
  processing: ProcessingConfig;
  storage: StorageConfig;
  errors: ErrorMessages;
}

export default config;
