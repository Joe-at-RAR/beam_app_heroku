#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🚀 Building Beam Server for distribution...');

// Helper functions
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function copyFile(src, dest) {
  fs.copyFileSync(src, dest);
}

function copyDir(src, dest) {
  ensureDir(dest);
  const entries = fs.readdirSync(src, { withFileTypes: true });
  
  for (let entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      copyFile(srcPath, destPath);
    }
  }
}

function writeFile(filePath, content) {
  fs.writeFileSync(filePath, content, 'utf8');
}

function exec(command, description) {
  console.log(`⚙️  ${description}...`);
  try {
    execSync(command, { stdio: 'inherit' });
  } catch (error) {
    console.error(`❌ Error during ${description.toLowerCase()}: ${error.message}`);
    process.exit(1);
  }
}

// Clean previous build
console.log('🧹 Cleaning previous build...');
if (fs.existsSync('dist')) {
  fs.rmSync('dist', { recursive: true, force: true });
}
if (fs.existsSync('release')) {
  fs.rmSync('release', { recursive: true, force: true });
}

// Detect package manager
let packageManager = 'npm';
if (fs.existsSync('pnpm-lock.yaml')) {
  packageManager = 'pnpm';
} else if (fs.existsSync('yarn.lock')) {
  packageManager = 'yarn';
}

console.log(`📦 Using package manager: ${packageManager}`);

// Install dependencies and build
const installCmd = packageManager === 'pnpm' ? 'pnpm install --frozen-lockfile --prod=false' : 
                  packageManager === 'yarn' ? 'yarn install --frozen-lockfile' : 'npm ci';
exec(installCmd, 'Installing dependencies');

const prismaCmd = `${packageManager} run prisma:generate`;
exec(prismaCmd, 'Generating Prisma client');

const buildCmd = `${packageManager} run build`;
exec(buildCmd, 'Compiling TypeScript');

// Create release structure
console.log('📁 Creating release package...');
ensureDir('release/beam-server');

// Copy compiled code
copyDir('dist', 'release/beam-server/dist');

// Copy Prisma schema
ensureDir('release/beam-server/prisma');
copyFile('prisma/schema.prisma', 'release/beam-server/prisma/schema.prisma');

// Copy essential files
if (fs.existsSync('README.md')) {
  copyFile('README.md', 'release/beam-server/README.md');
}
if (fs.existsSync('Procfile')) {
  copyFile('Procfile', 'release/beam-server/Procfile');
}

// Create production package.json
const productionPackage = {
  name: "beam_server",
  version: "1.0.0",
  description: "Server for Beam application",
  main: "dist/src/index.js",
  scripts: {
    start: "node dist/src/index.js",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate deploy",
    postinstall: "npm run prisma:generate"
  },
  dependencies: {
    "@azure/ai-form-recognizer": "^5.0.0",
    "@azure/core-auth": "^1.9.0",
    "@azure/openai": "^1.0.0-beta.11",
    "@azure/storage-blob": "^12.27.0",
    "@prisma/client": "^5.1.1",
    "axios": "^1.7.9",
    "cors": "^2.8.5",
    "dotenv": "^16.4.7",
    "express": "^4.18.2",
    "formidable": "^3.5.1",
    "jsonwebtoken": "^9.0.2",
    "langchain": "^0.3.26",
    "libreoffice-convert": "^1.6.0",
    "mammoth": "^1.6.0",
    "multer": "^1.4.5-lts.1",
    "mysql2": "^3.14.0",
    "nanoid": "^5.1.5",
    "node-cache": "^5.1.2",
    "node-qpdf2": "^6.0.0",
    "openai": "4.68.4",
    "pdf-lib": "^1.17.1",
    "pdf2pic": "^3.1.4",
    "prisma": "^5.1.1",
    "prisma-field-encryption": "^1.6.0",
    "rate-limiter-flexible": "^5.0.5",
    "sharp": "^0.34.1",
    "socket.io": "^4.8.1",
    "uuid": "^11.1.0",
    "zod": "^3.24.1",
    "zod-to-json-schema": "^3.24.3"
  }
};

writeFile('release/beam-server/package.json', JSON.stringify(productionPackage, null, 2));

// Create environment template
const envTemplate = `# Database Configuration
DATABASE_URL="mysql://username:password@host:port/database_name"

# Azure Document Intelligence
AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT="https://your-resource.cognitiveservices.azure.com/"
AZURE_DOCUMENT_INTELLIGENCE_KEY="your-key-here"

# Azure OpenAI
AZURE_OPENAI_ENDPOINT="https://your-resource.openai.azure.com/"
AZURE_OPENAI_API_KEY="your-api-key-here"
AZURE_OPENAI_DEPLOYMENT="your-deployment-name"

# Azure Blob Storage
AZURE_STORAGE_CONNECTION_STRING="DefaultEndpointsProtocol=https;AccountName=...;AccountKey=...;EndpointSuffix=core.windows.net"
AZURE_STORAGE_CONTAINER_NAME="your-container-name"

# Application Settings
PORT=3000
NODE_ENV=production
JWT_SECRET="your-jwt-secret-key-here"
CORS_ORIGIN="https://your-frontend-domain.com"

# Optional: Rate Limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100

# Optional: File Processing
MAX_FILE_SIZE_MB=50
SUPPORTED_FILE_TYPES="pdf,doc,docx"
`;

writeFile('release/beam-server/.env.example', envTemplate);

// Create cross-platform startup script (Unix)
const unixStartScript = `#!/bin/bash

# Beam Server Startup Script

set -e

echo "🚀 Starting Beam Server..."

# Check if .env file exists
if [ ! -f .env ]; then
    echo "❌ Error: .env file not found!"
    echo "Please copy .env.example to .env and configure your environment variables."
    exit 1
fi

echo "✅ Environment file found"

# Run database migrations
echo "🔧 Running database migrations..."
npm run prisma:migrate

echo "✅ Database setup complete"

# Start the server
echo "🌟 Starting Beam Server..."
npm start
`;

writeFile('release/beam-server/start.sh', unixStartScript);

// Create Windows startup script
const windowsStartScript = `@echo off
REM Beam Server Startup Script for Windows

echo 🚀 Starting Beam Server...

if not exist .env (
    echo ❌ Error: .env file not found!
    echo Please copy .env.example to .env and configure your environment variables.
    exit /b 1
)

echo ✅ Environment file found

echo 🔧 Running database migrations...
npm run prisma:migrate

echo ✅ Database setup complete

echo 🌟 Starting Beam Server...
npm start
`;

writeFile('release/beam-server/start.bat', windowsStartScript);

// Create Node.js startup script (cross-platform)
const nodeStartScript = `#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🚀 Starting Beam Server...');

// Check if .env file exists
if (!fs.existsSync('.env')) {
    console.error('❌ Error: .env file not found!');
    console.error('Please copy .env.example to .env and configure your environment variables.');
    process.exit(1);
}

console.log('✅ Environment file found');

try {
    console.log('🔧 Running database migrations...');
    execSync('npm run prisma:migrate', { stdio: 'inherit' });
    
    console.log('✅ Database setup complete');
    
    console.log('🌟 Starting Beam Server...');
    execSync('npm start', { stdio: 'inherit' });
} catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
}
`;

writeFile('release/beam-server/start.js', nodeStartScript);

// Create README
const readme = `# Beam Server - Production Deployment

## Quick Start

1. **Install Dependencies**
   \`\`\`bash
   npm install
   \`\`\`

2. **Configure Environment**
   \`\`\`bash
   cp .env.example .env
   # Edit .env with your configuration
   \`\`\`

3. **Start Server**
   
   **Option A: Using startup scripts**
   \`\`\`bash
   # On Unix/Linux/macOS:
   chmod +x start.sh && ./start.sh
   
   # On Windows:
   start.bat
   
   # Cross-platform (Node.js):
   node start.js
   \`\`\`
   
   **Option B: Manual steps**
   \`\`\`bash
   npm run prisma:migrate  # Setup database
   npm start                # Start server
   \`\`\`

## Environment Variables

See \`.env.example\` for all required configuration options.

### Required Variables
- \`DATABASE_URL\`: Database connection string
- \`AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT\`: Azure Document Intelligence endpoint
- \`AZURE_DOCUMENT_INTELLIGENCE_KEY\`: Azure Document Intelligence API key
- \`AZURE_OPENAI_ENDPOINT\`: Azure OpenAI endpoint
- \`AZURE_OPENAI_API_KEY\`: Azure OpenAI API key
- \`AZURE_STORAGE_CONNECTION_STRING\`: Azure Blob Storage connection string

## Health Check

Visit \`http://localhost:3000/health\` to verify the server is running.

## Production Deployment

### Using PM2
\`\`\`bash
npm install -g pm2
pm2 start dist/src/index.js --name beam-server
pm2 startup
pm2 save
\`\`\`

### Using Docker
See \`Dockerfile\` for containerized deployment.

## Support

Contact your development team for technical support.
`;

writeFile('release/beam-server/README.md', readme);

// Make Unix scripts executable
try {
  fs.chmodSync('release/beam-server/start.sh', 0o755);
  fs.chmodSync('release/beam-server/start.js', 0o755);
} catch (error) {
  // Ignore chmod errors on Windows
}

// Create Docker files
const dockerfile = `FROM node:18-alpine

# Install system dependencies for native modules
RUN apk add --no-cache \\
    python3 \\
    make \\
    g++ \\
    libreoffice \\
    poppler-utils

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY dist ./dist/

# Generate Prisma client
RUN npm run prisma:generate

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S beam -u 1001
USER beam

EXPOSE 3000

CMD ["npm", "start"]
`;

writeFile('release/beam-server/Dockerfile', dockerfile);

const dockerCompose = `version: '3.8'

services:
  beam-server:
    build: .
    ports:
      - "\${PORT:-3000}:3000"
    environment:
      - NODE_ENV=production
    env_file:
      - .env
    restart: unless-stopped
    depends_on:
      - database

  database:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: \${DB_ROOT_PASSWORD}
      MYSQL_DATABASE: \${DB_NAME}
      MYSQL_USER: \${DB_USER}
      MYSQL_PASSWORD: \${DB_PASSWORD}
    volumes:
      - mysql_data:/var/lib/mysql
    restart: unless-stopped

volumes:
  mysql_data:
`;

writeFile('release/beam-server/docker-compose.yml', dockerCompose);

console.log('✅ Build complete!');
console.log('');
console.log('📁 Distribution package created in: release/beam-server/');
console.log('📋 Files included:');
console.log('   - Compiled JavaScript code (dist/)');
console.log('   - Production package.json');
console.log('   - Environment template (.env.example)');
console.log('   - Startup scripts (start.sh, start.bat, start.js)');
console.log('   - Docker configuration');
console.log('   - Documentation (README.md)');
console.log('');
console.log('🎯 To deploy:');
console.log('   1. Copy the release/beam-server folder to target server');
console.log('   2. Copy .env.example to .env and configure');
console.log('   3. Run: npm install');
console.log('   4. Run: node start.js (or ./start.sh on Unix)');
console.log('');
console.log('🐳 For Docker deployment:');
console.log('   1. Configure .env file');
console.log('   2. Run: docker-compose up -d'); 