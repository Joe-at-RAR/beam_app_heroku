-- Add silknote properties to existing VSRX tables and create new silknote tables

-- 1. Add silknoteUserUuid to staff table
ALTER TABLE staff 
ADD COLUMN silknoteUserUuid VARCHAR(36) UNIQUE DEFAULT (UUID());

-- 2. Add silknotePatientUuid to candidates table
ALTER TABLE candidates 
ADD COLUMN silknotePatientUuid VARCHAR(36) DEFAULT (UUID());

-- 3. Create silknote_patient_filesets table
CREATE TABLE IF NOT EXISTS silknote_patient_filesets (
    silknotePatientUuid VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    silknoteUserUuid LONGTEXT NOT NULL, 
    activatedUse BOOLEAN DEFAULT FALSE,
    activatedUseTime DATETIME NULL,
    patientName VARCHAR(255) NULL,
    patientDob VARCHAR(10) NULL, 
    gender VARCHAR(50) NULL,
    vectorStoreJson TEXT NULL,
    caseSummaryJson TEXT NULL,
    summaryGenerationCount INT DEFAULT 0,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    errors JSON NULL,
    
    INDEX idx_silknotePatientUuid (silknotePatientUuid),
    INDEX idx_silknoteUserUuid (silknoteUserUuid)
);

-- 4. Create silknote_documents table
CREATE TABLE IF NOT EXISTS silknote_documents (
    silknoteDocumentUuid VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    patientUuid VARCHAR(36) NOT NULL,
    originalName VARCHAR(255) NOT NULL,
    clientFileId VARCHAR(255) NULL,
    storedPath VARCHAR(500) NULL,
    status VARCHAR(50) NOT NULL,
    category VARCHAR(100) NOT NULL, 
    mimeType VARCHAR(100) NOT NULL,
    sizeBytes INT NULL,
    pageCount INT NULL,
    documentDate VARCHAR(50) NULL,
    uploadDate DATETIME DEFAULT CURRENT_TIMESTAMP,
    processedAt DATETIME NULL,
    title VARCHAR(255) NULL, 
    author VARCHAR(255) NULL,
    sourceSystem VARCHAR(50) NULL,
    contentJson TEXT NULL,
    alertsJson TEXT NULL, 
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    VSRXReference VARCHAR(36) NULL,
    
    FOREIGN KEY (patientUuid) REFERENCES silknote_patient_filesets(silknotePatientUuid) ON DELETE CASCADE,
    
    INDEX idx_patientUuid (patientUuid),
    INDEX idx_status (status),
    INDEX idx_category (category),
    INDEX idx_clientFileId (clientFileId),
    INDEX idx_clientFileId_patientUuid (clientFileId, patientUuid)
);

-- Add indexes to existing tables for the new columns
CREATE INDEX idx_staff_silknoteUserUuid ON staff(silknoteUserUuid);
CREATE INDEX idx_candidates_silknotePatientUuid ON candidates(silknotePatientUuid); 