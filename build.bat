@echo off
REM Build script for Beam Server (Windows)
REM This script compiles the TypeScript code and packages it for distribution

echo 🚀 Building Beam Server for distribution...

REM Clean previous build
echo 🧹 Cleaning previous build...
if exist dist rmdir /s /q dist
if exist release rmdir /s /q release
mkdir release

REM Check for package managers
where pnpm >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    set PKG_MANAGER=pnpm
    goto :install_deps
)

where npm >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    set PKG_MANAGER=npm
    goto :install_deps
)

echo ❌ Error: Neither pnpm nor npm found. Please install Node.js and pnpm/npm.
exit /b 1

:install_deps
echo 📦 Installing dependencies...
if "%PKG_MANAGER%"=="pnpm" (
    pnpm install --frozen-lockfile --prod=false
) else (
    npm ci
)

REM Generate Prisma client
echo 🔧 Generating Prisma client...
if "%PKG_MANAGER%"=="pnpm" (
    pnpm run prisma:generate
) else (
    npm run prisma:generate
)

REM Compile TypeScript
echo ⚙️ Compiling TypeScript...
if "%PKG_MANAGER%"=="pnpm" (
    pnpm run build
) else (
    npm run build
)

REM Create release directory structure
echo 📁 Creating release package...
mkdir release\beam-server

REM Copy compiled code
xcopy /E /I dist release\beam-server\dist

REM Copy essential files
copy package.json release\beam-server\
copy Procfile release\beam-server\
if exist README.md copy README.md release\beam-server\

REM Copy Prisma schema
mkdir release\beam-server\prisma
copy prisma\schema.prisma release\beam-server\prisma\

echo 📋 Creating production files...

REM Create production package.json
(
echo {
echo   "name": "beam_server",
echo   "version": "1.0.0",
echo   "description": "Server for Beam application",
echo   "main": "dist/src/index.js",
echo   "scripts": {
echo     "start": "node dist/src/index.js",
echo     "prisma:generate": "prisma generate",
echo     "prisma:migrate": "prisma migrate deploy",
echo     "postinstall": "npm run prisma:generate"
echo   },
echo   "dependencies": {
echo     "@azure/ai-form-recognizer": "^5.0.0",
echo     "@azure/core-auth": "^1.9.0",
echo     "@azure/openai": "^1.0.0-beta.11",
echo     "@azure/storage-blob": "^12.27.0",
echo     "@prisma/client": "^5.1.1",
echo     "axios": "^1.7.9",
echo     "cors": "^2.8.5",
echo     "dotenv": "^16.4.7",
echo     "express": "^4.18.2",
echo     "formidable": "^3.5.1",
echo     "jsonwebtoken": "^9.0.2",
echo     "langchain": "^0.3.26",
echo     "libreoffice-convert": "^1.6.0",
echo     "mammoth": "^1.6.0",
echo     "multer": "^1.4.5-lts.1",
echo     "mysql2": "^3.14.0",
echo     "nanoid": "^5.1.5",
echo     "node-cache": "^5.1.2",
echo     "node-qpdf2": "^6.0.0",
echo     "openai": "4.68.4",
echo     "pdf-lib": "^1.17.1",
echo     "pdf2pic": "^3.1.4",
echo     "prisma": "^5.1.1",
echo     "prisma-field-encryption": "^1.6.0",
echo     "rate-limiter-flexible": "^5.0.5",
echo     "sharp": "^0.34.1",
echo     "socket.io": "^4.8.1",
echo     "uuid": "^11.1.0",
echo     "zod": "^3.24.1",
echo     "zod-to-json-schema": "^3.24.3"
echo   }
echo }
) > release\beam-server\package.json

REM Create environment template
(
echo # Database Configuration
echo DATABASE_URL="mysql://username:password@host:port/database_name"
echo.
echo # Azure Document Intelligence
echo AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT="https://your-resource.cognitiveservices.azure.com/"
echo AZURE_DOCUMENT_INTELLIGENCE_KEY="your-key-here"
echo.
echo # Azure OpenAI
echo AZURE_OPENAI_ENDPOINT="https://your-resource.openai.azure.com/"
echo AZURE_OPENAI_API_KEY="your-api-key-here"
echo AZURE_OPENAI_DEPLOYMENT="your-deployment-name"
echo.
echo # Azure Blob Storage
echo AZURE_STORAGE_CONNECTION_STRING="DefaultEndpointsProtocol=https;AccountName=...;AccountKey=...;EndpointSuffix=core.windows.net"
echo AZURE_STORAGE_CONTAINER_NAME="your-container-name"
echo.
echo # Application Settings
echo PORT=3000
echo NODE_ENV=production
echo JWT_SECRET="your-jwt-secret-key-here"
echo CORS_ORIGIN="https://your-frontend-domain.com"
echo.
echo # Optional: Rate Limiting
echo RATE_LIMIT_WINDOW_MS=60000
echo RATE_LIMIT_MAX_REQUESTS=100
echo.
echo # Optional: File Processing
echo MAX_FILE_SIZE_MB=50
echo SUPPORTED_FILE_TYPES="pdf,doc,docx"
) > release\beam-server\.env.example

REM Create Windows startup script
(
echo @echo off
echo REM Beam Server Startup Script for Windows
echo.
echo echo 🚀 Starting Beam Server...
echo.
echo if not exist .env ^(
echo     echo ❌ Error: .env file not found!
echo     echo Please copy .env.example to .env and configure your environment variables.
echo     exit /b 1
echo ^)
echo.
echo echo ✅ Environment file found
echo.
echo echo 🔧 Running database migrations...
echo npm run prisma:migrate
echo.
echo echo ✅ Database setup complete
echo.
echo echo 🌟 Starting Beam Server...
echo npm start
) > release\beam-server\start.bat

echo ✅ Build complete!
echo.
echo 📁 Distribution package created in: release\beam-server\
echo 📋 Files included:
echo    - Compiled JavaScript code ^(dist/^)
echo    - Production package.json
echo    - Environment template ^(.env.example^)
echo    - Startup scripts ^(start.bat^)
echo.
echo 🎯 To deploy:
echo    1. Copy the release\beam-server folder to target server
echo    2. Copy .env.example to .env and configure
echo    3. Run: npm install
echo    4. Run: start.bat

pause 