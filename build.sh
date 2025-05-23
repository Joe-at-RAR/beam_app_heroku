#!/bin/bash

# Build script for Beam Server
# This script compiles the TypeScript code and packages it for distribution

set -e  # Exit on any error

echo "🚀 Building Beam Server for distribution..."

# Clean previous build
echo "🧹 Cleaning previous build..."
rm -rf dist/
rm -rf release/
mkdir -p release

# Install dependencies
echo "📦 Installing dependencies..."
if command -v pnpm &> /dev/null; then
    pnpm install --frozen-lockfile --prod=false
elif command -v npm &> /dev/null; then
    npm ci
else
    echo "❌ Error: Neither pnpm nor npm found. Please install Node.js and pnpm/npm."
    exit 1
fi

# Generate Prisma client
echo "🔧 Generating Prisma client..."
if command -v pnpm &> /dev/null; then
    pnpm run prisma:generate
else
    npm run prisma:generate
fi

# Compile TypeScript
echo "⚙️  Compiling TypeScript..."
if command -v pnpm &> /dev/null; then
    pnpm run build
else
    npm run build
fi

# Create release directory structure
echo "📁 Creating release package..."
mkdir -p release/beam-server

# Copy compiled code
cp -r dist/ release/beam-server/

# Copy essential files
cp package.json release/beam-server/
cp Procfile release/beam-server/
cp README.md release/beam-server/ || echo "⚠️  README.md not found, skipping"

# Copy Prisma schema (needed for migrations)
mkdir -p release/beam-server/prisma
cp prisma/schema.prisma release/beam-server/prisma/

# Create production package.json (only production dependencies)
echo "📋 Creating production package.json..."
cat > release/beam-server/package.json << 'EOF'
{
  "name": "beam_server",
  "version": "1.0.0",
  "description": "Server for Beam application",
  "main": "dist/src/index.js",
  "scripts": {
    "start": "node dist/src/index.js",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate deploy",
    "postinstall": "npm run prisma:generate"
  },
  "dependencies": {
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
}
EOF

# Create deployment instructions
cat > release/beam-server/DEPLOYMENT.md << 'EOF'
# Beam Server Deployment Guide

## Prerequisites
- Node.js 18+ installed
- npm or pnpm package manager
- Database (MySQL/PostgreSQL) accessible
- Required Azure services configured

## Quick Start

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Set Environment Variables**
   Copy `.env.example` to `.env` and configure all required variables (see below).

3. **Setup Database**
   ```bash
   npm run prisma:migrate
   ```

4. **Start Server**
   ```bash
   npm start
   ```

The server will start on the port specified in the PORT environment variable (default: 3000).

## Required Environment Variables

Create a `.env` file with the following variables:

### Database
```
DATABASE_URL="mysql://username:password@host:port/database_name"
```

### Azure Services
```
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
```

### Application Settings
```
PORT=3000
NODE_ENV=production
JWT_SECRET="your-jwt-secret-key"
CORS_ORIGIN="https://your-frontend-domain.com"
```

### Optional Settings
```
# Rate limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100

# File processing
MAX_FILE_SIZE_MB=50
SUPPORTED_FILE_TYPES="pdf,doc,docx"
```

## Production Deployment

### Using PM2 (Recommended)
```bash
npm install -g pm2
pm2 start dist/src/index.js --name beam-server
pm2 startup
pm2 save
```

### Using Docker
See `Dockerfile` for containerized deployment.

### Direct Node.js
```bash
npm start
```

## Health Check
Visit `http://localhost:3000/health` to verify the server is running.

## Troubleshooting

### Common Issues
1. **Database Connection**: Ensure DATABASE_URL is correct and database is accessible
2. **Azure Services**: Verify all Azure endpoints and keys are valid
3. **File Permissions**: Ensure the application has read/write access to temp directories
4. **Memory**: Monitor memory usage for large file processing

### Logs
Check application logs for detailed error information.

### Support
Contact the development team for technical support.
EOF

# Create environment template
cat > release/beam-server/.env.example << 'EOF'
# Database Configuration
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
EOF

# Create startup script
cat > release/beam-server/start.sh << 'EOF'
#!/bin/bash

# Beam Server Startup Script

set -e

echo "🚀 Starting Beam Server..."

# Check if .env file exists
if [ ! -f .env ]; then
    echo "❌ Error: .env file not found!"
    echo "Please copy .env.example to .env and configure your environment variables."
    exit 1
fi

# Source environment variables
export $(cat .env | grep -v '^#' | xargs)

# Validate required environment variables
required_vars=(
    "DATABASE_URL"
    "AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT"
    "AZURE_DOCUMENT_INTELLIGENCE_KEY"
    "AZURE_OPENAI_ENDPOINT"
    "AZURE_OPENAI_API_KEY"
    "AZURE_STORAGE_CONNECTION_STRING"
)

for var in "${required_vars[@]}"; do
    if [ -z "${!var}" ]; then
        echo "❌ Error: Required environment variable $var is not set"
        exit 1
    fi
done

echo "✅ Environment variables validated"

# Run database migrations
echo "🔧 Running database migrations..."
npm run prisma:migrate

echo "✅ Database setup complete"

# Start the server
echo "🌟 Starting Beam Server on port ${PORT:-3000}..."
npm start
EOF

chmod +x release/beam-server/start.sh

# Create a simple Dockerfile for containerized deployment
cat > release/beam-server/Dockerfile << 'EOF'
FROM node:18-alpine

# Install system dependencies for native modules
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    libreoffice \
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
EOF

# Create docker-compose for easy deployment
cat > release/beam-server/docker-compose.yml << 'EOF'
version: '3.8'

services:
  beam-server:
    build: .
    ports:
      - "${PORT:-3000}:3000"
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
      MYSQL_ROOT_PASSWORD: ${DB_ROOT_PASSWORD}
      MYSQL_DATABASE: ${DB_NAME}
      MYSQL_USER: ${DB_USER}
      MYSQL_PASSWORD: ${DB_PASSWORD}
    volumes:
      - mysql_data:/var/lib/mysql
    restart: unless-stopped

volumes:
  mysql_data:
EOF

# Create tarball for distribution
echo "📦 Creating distribution package..."
cd release
tar -czf beam-server-$(date +%Y%m%d-%H%M%S).tar.gz beam-server/
cd ..

echo "✅ Build complete!"
echo ""
echo "📁 Distribution package created in: release/"
echo "📋 Files included:"
echo "   - Compiled JavaScript code (dist/)"
echo "   - Production package.json"
echo "   - Deployment documentation"
echo "   - Environment template (.env.example)"
echo "   - Startup scripts"
echo "   - Docker configuration"
echo ""
echo "🎯 To deploy:"
echo "   1. Extract the tar.gz file on target server"
echo "   2. Copy .env.example to .env and configure"
echo "   3. Run: npm install"
echo "   4. Run: ./start.sh"
echo ""
echo "🐳 For Docker deployment:"
echo "   1. Configure .env file"
echo "   2. Run: docker-compose up -d" 