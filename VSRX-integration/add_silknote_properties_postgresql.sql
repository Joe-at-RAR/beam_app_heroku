-- Add silknote properties to existing VSRX tables and create new silknote tables (PostgreSQL version)

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Add silknoteUserUuid to staff table
ALTER TABLE staff 
ADD COLUMN IF NOT EXISTS silknoteUserUuid UUID UNIQUE DEFAULT uuid_generate_v4();

-- 2. Add silknotePatientUuid to candidates table
ALTER TABLE candidates 
ADD COLUMN IF NOT EXISTS silknotePatientUuid UUID DEFAULT uuid_generate_v4();

-- 3. Create silknote_patient_filesets table
CREATE TABLE IF NOT EXISTS silknote_patient_filesets (
    "silknotePatientUuid" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "silknoteUserUuid" UUID NOT NULL, -- No FK constraint as requested
    "activatedUse" BOOLEAN DEFAULT FALSE,
    "activatedUseTime" TIMESTAMP NULL,
    "patientName" VARCHAR(255) NULL,
    "patientDob" VARCHAR(10) NULL, -- DD/MM/YYYY format
    "gender" VARCHAR(50) NULL,
    "vectorStoreJson" TEXT NULL,
    "caseSummaryJson" TEXT NULL,
    "summaryGenerationCount" INTEGER DEFAULT 0,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "errors" JSONB NULL
);

-- Create indexes for silknote_patient_filesets
CREATE INDEX IF NOT EXISTS idx_silknote_patient_filesets_uuid ON silknote_patient_filesets("silknotePatientUuid");
CREATE INDEX IF NOT EXISTS idx_silknote_patient_filesets_user_uuid ON silknote_patient_filesets("silknoteUserUuid");

-- 5. Create silknote_documents table
CREATE TABLE IF NOT EXISTS silknote_documents (
    "silknoteDocumentUuid" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "patientUuid" UUID NOT NULL,
    "originalName" VARCHAR(255) NOT NULL,
    "clientFileId" VARCHAR(255) NULL,
    "storedPath" VARCHAR(500) NULL,
    "status" VARCHAR(50) NOT NULL,
    "category" VARCHAR(100) NOT NULL, -- Will be encrypted
    "mimeType" VARCHAR(100) NOT NULL,
    "sizeBytes" INTEGER NULL,
    "pageCount" INTEGER NULL,
    "documentDate" VARCHAR(50) NULL,
    "uploadDate" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP NULL,
    "title" VARCHAR(255) NULL, -- Will be encrypted
    "author" VARCHAR(255) NULL, -- Will be encrypted
    "sourceSystem" VARCHAR(50) NULL,
    "contentJson" TEXT NULL, -- Will be encrypted
    "alertsJson" TEXT NULL, -- Will be encrypted
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "VSRXReference" VARCHAR(36) NULL,
    
    CONSTRAINT fk_patient_uuid FOREIGN KEY ("patientUuid") 
        REFERENCES silknote_patient_filesets("silknotePatientUuid") 
        ON DELETE CASCADE
);

-- Create indexes for silknote_documents
CREATE INDEX IF NOT EXISTS idx_silknote_documents_patient_uuid ON silknote_documents("patientUuid");
CREATE INDEX IF NOT EXISTS idx_silknote_documents_status ON silknote_documents("status");
CREATE INDEX IF NOT EXISTS idx_silknote_documents_category ON silknote_documents("category");
CREATE INDEX IF NOT EXISTS idx_silknote_documents_client_file_id ON silknote_documents("clientFileId");
CREATE INDEX IF NOT EXISTS idx_silknote_documents_composite ON silknote_documents("clientFileId", "patientUuid");

-- Add indexes to existing tables for the new columns
CREATE INDEX IF NOT EXISTS idx_staff_silknote_user_uuid ON staff("silknoteUserUuid");
CREATE INDEX IF NOT EXISTS idx_candidates_silknote_patient_uuid ON candidates("silknotePatientUuid");

-- Create trigger to update the updatedAt timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW."updatedAt" = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply the trigger to both tables
DROP TRIGGER IF EXISTS update_silknote_patient_filesets_updated_at ON silknote_patient_filesets;
CREATE TRIGGER update_silknote_patient_filesets_updated_at 
    BEFORE UPDATE ON silknote_patient_filesets 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_silknote_documents_updated_at ON silknote_documents;
CREATE TRIGGER update_silknote_documents_updated_at 
    BEFORE UPDATE ON silknote_documents 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column(); 