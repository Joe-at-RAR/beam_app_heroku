# PROJECT_DETAILS.md

## Overview

Beam Server is a medical document management and AI-powered analysis platform designed to help healthcare professionals efficiently process, analyze, and query patient medical documents. The system leverages advanced AI capabilities including Azure OpenAI, document intelligence, and vector search to provide semantic understanding of medical records, automated case summaries, and intelligent document querying with citation tracking.

## System Architecture

### Backend Architecture
- **Runtime**: Node.js with TypeScript
- **Framework**: Express.js REST API server
- **Database**: PostgreSQL with Prisma ORM (primary), MySQL support for VSRX integration
- **File Storage**: Azure Blob Storage (production), Local filesystem (development)
- **AI/ML Stack**: Azure OpenAI (GPT models), Azure Document Intelligence (OCR), LangChain orchestration
- **Real-time**: Socket.IO for WebSocket connections and live updates
- **Authentication**: JWT tokens with custom auth middleware
- **Security**: Field-level encryption, rate limiting, request validation with Zod

### Frontend Architecture
This repository contains only the backend server. Frontend is a separate application that communicates via REST API and WebSocket connections.

### Deployment Modes
The system supports three distinct deployment configurations:
1. **LOCAL**: JSON file storage + local filesystem (development)
2. **SILKNOTE**: PostgreSQL + Azure Blob Storage (production)
3. **VSRX**: MySQL + Azure Blob Storage (integration mode)

## Key Components

### Database Schema
- **User Management**: User, organization, role-based access
- **Patient Data**: PatientInfo, SilknotePatientFileset, ConsultSession
- **Document Management**: SilknoteDocument, CreatedDocument, CustomDocument
- **AI Processing**: Vector store management, case summaries with citations
- **Audit & Compliance**: TokenUsage, ActionLog, RateLimit tracking

### Document Processing Pipeline
1. **Upload**: Multi-file upload with validation (PDF, images, Word docs)
2. **Storage**: Secure cloud or local file storage
3. **Queue**: Background processing with rate limiting
4. **Analysis**: OCR + AI analysis for content extraction and classification
5. **Enrichment**: Schema-based medical data structuring
6. **Vector Store**: Semantic indexing for intelligent search
7. **Alerts**: Quality checks and automated patient matching

### Authentication / Authorization
- Header-based user UUID extraction via auth middleware
- Multi-tenant architecture with user isolation
- Field-level encryption for sensitive medical data
- Rate limiting and abuse prevention

### File / Asset Management
- Unified storage service with pluggable adapters
- Support for Azure Blob Storage and local filesystem
- VSRX path validation for external file access
- Document deduplication and retention policies

## Data Flow Diagram

**Typical Document Processing Flow:**
User uploads documents → Authentication middleware → File storage → Background queue → AI analysis (OCR + content extraction) → Data enrichment → Vector store indexing → Real-time status updates via WebSocket → Document available for querying

**Query Processing Flow:**
User submits query → Authentication → Vector search for relevant documents → LLM processing with context → Response with citations → Audit logging

## External Dependencies

### Core Technologies
- **Node.js**: JavaScript runtime
- **PostgreSQL**: Primary database engine
- **MySQL**: VSRX integration database
- **Azure Blob Storage**: Cloud file storage
- **Azure OpenAI**: GPT models for AI processing
- **Azure Document Intelligence**: OCR and document analysis

### Libraries & Frameworks
- **Express.js**: Web framework
- **Prisma**: Database ORM and migrations
- **Socket.IO**: Real-time WebSocket communication
- **LangChain**: AI orchestration framework
- **Zod**: Schema validation
- **Sharp**: Image processing
- **pdf-lib, pdf2pic**: PDF manipulation
- **mammoth**: Word document processing

### Dev Tooling
- **TypeScript**: Type safety and compilation
- **Jest**: Testing framework
- **tsc-watch**: Development hot reload
- **Prisma Studio**: Database management GUI

## Deployment Strategy

### Production Environment
- **Hosting**: Configurable cloud deployment
- **Build Pipeline**: TypeScript compilation with npm scripts
- **Scaling**: Horizontal scaling supported via stateless design
- **Monitoring**: Comprehensive logging and audit trails

### Development Environment
- **Local Setup**: `npm install && npm run dev`
- **Hot Reload**: tsc-watch for automatic restart
- **Test Database**: Local PostgreSQL or SQLite
- **Mock Services**: Local file storage instead of Azure Blob

## Configuration & Secrets

### Required Environment Variables
- `DATABASE_URL`: Database connection string
- `AZURE_OPENAI_API_KEY`: Azure OpenAI service key
- `AZURE_STORAGE_CONNECTION_STRING`: Blob storage connection
- `JWT_SECRET`: Authentication token signing key
- `ENVIRONMENT`: Deployment mode (LOCAL/SILKNOTE/VSRX)
- `PORT`: Server port (default: 3000)

### Non-secret Defaults
- Rate limiting: 100 requests per 15 minutes per IP
- File upload limit: 50MB per file
- WebSocket room prefix: patient-specific channels
- Default pagination: 20 items per page

## Changelog Convention

Changes are tracked through Git commits with conventional commit messages:
- `feat:` for new features
- `fix:` for bug fixes
- `docs:` for documentation changes
- `refactor:` for code refactoring
- `chore:` for maintenance tasks

Recent significant changes include VSRX integration, authentication middleware refactoring, and document deletion API removal.

## User Preferences / UX Principles

### Medical Compliance
- All patient data must be encrypted at rest and in transit
- Comprehensive audit logging for compliance requirements
- User actions must be traceable and attributable

### AI Interaction
- All AI-generated content must include citations to source documents
- Processing status must be communicated in real-time
- AI responses should prioritize accuracy over speed

### Developer Experience
- Prefer TypeScript strict mode for type safety
- Use Prisma for all database operations
- Follow established error handling patterns
- Maintain comprehensive logging for debugging

### Performance Requirements
- Document processing should be asynchronous with progress updates
- Vector search results must be returned within 3 seconds
- File uploads support progress tracking and resumable uploads
- Rate limiting prevents system abuse while allowing legitimate usage