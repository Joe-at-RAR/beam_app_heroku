# VSRX Database Migration: Silknote Integration

## Prerequisites
- MySQL 5.7+ or 8.0+
- Database backup completed

## Migration Steps

### Step 1: Add UUID Fields to Existing Tables

```sql
-- Add UUID field to staff table
ALTER TABLE `staff` 
ADD COLUMN `silknoteUserUuid` VARCHAR(36) NULL UNIQUE;

-- Add UUID field to candidates table
ALTER TABLE `candidates` 
ADD COLUMN `silknotePatientUuid` VARCHAR(36) NULL;

-- Add UUID field to ax_notes_attachments table
ALTER TABLE `ax_notes_attachments` 
ADD COLUMN `file_uuid` VARCHAR(36) NULL;
```

### Step 2: Create Silknote Patient Filesets Table

```sql
CREATE TABLE `silknote_patient_filesets` (
  `silknotePatientUuid` VARCHAR(36) NOT NULL PRIMARY KEY,
  `silknoteUserUuid` LONGTEXT NOT NULL,
  `patientName` VARCHAR(255) NULL,
  `patientDob` VARCHAR(20) NULL,
  `gender` VARCHAR(20) NULL,
  `vectorStoreJson` TEXT NULL,
  `caseSummaryJson` TEXT NULL,
  `summaryGenerationCount` INT NULL DEFAULT 0,
  `activatedUse` BOOLEAN DEFAULT FALSE,
  `activatedUseTime` DATETIME NULL,
  `errors` JSON NULL,
  `createdAt` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

### Step 3: Create Silknote Documents Table

```sql
CREATE TABLE `silknote_documents` (
  `silknoteDocumentUuid` VARCHAR(36) NOT NULL PRIMARY KEY,
  `patientUuid` VARCHAR(36) NOT NULL,
  `clientFileId` VARCHAR(255) NULL,
  `originalName` VARCHAR(500) NOT NULL,
  `VSRXReference` VARCHAR(36) NULL,
  `storedPath` TEXT NULL,
  `status` VARCHAR(50) NOT NULL DEFAULT 'queued',
  `category` VARCHAR(100) NOT NULL,
  `mimeType` VARCHAR(100) NOT NULL,
  `sizeBytes` BIGINT NULL,
  `pageCount` INT NULL,
  `documentDate` VARCHAR(20) NULL,
  `uploadDate` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `processedAt` DATETIME NULL,
  `title` VARCHAR(500) NULL,
  `author` VARCHAR(255) NULL,
  `sourceSystem` VARCHAR(50) DEFAULT 'upload',
  `contentJson` LONGTEXT NULL,
  `alertsJson` TEXT NULL,
  `createdAt` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

### Step 4: Add Indexes

```sql
-- Indexes for staff table
CREATE INDEX `idx_staff_silknote_uuid` ON `staff` (`silknoteUserUuid`); 

-- Indexes for candidates table
CREATE INDEX `idx_candidates_silknote_uuid` ON `candidates` (`silknotePatientUuid`);

-- Indexes for ax_notes_attachments table
CREATE INDEX `idx_attachments_file_uuid` ON `ax_notes_attachments` (`file_uuid`);

-- Indexes for silknote_patient_filesets
CREATE INDEX `idx_patient_filesets_patient_uuid` ON `silknote_patient_filesets` (`silknotePatientUuid`);
-- CREATE INDEX `idx_patient_filesets_user_uuid` ON `silknote_patient_filesets` (`silknoteUserUuid`); // Do not index by silknoteUserUuid on the file set incase in future this is used for CSV UUIDs
CREATE INDEX `idx_patient_filesets_activated` ON `silknote_patient_filesets` (`activatedUse`);

-- Indexes for silknote_documents
CREATE INDEX `idx_documents_patient_uuid` ON `silknote_documents` (`patientUuid`);
CREATE INDEX `idx_documents_status` ON `silknote_documents` (`status`);
CREATE INDEX `idx_documents_category` ON `silknote_documents` (`category`);
CREATE INDEX `idx_documents_client_file_id` ON `silknote_documents` (`clientFileId`);
CREATE INDEX `idx_documents_client_file_patient` ON `silknote_documents` (`clientFileId`, `patientUuid`);
CREATE INDEX `idx_documents_vsrx_reference` ON `silknote_documents` (`VSRXReference`);
```

### Step 5: Add Foreign Key Constraint

# No Foreign Key Constraint for silknoteUserUuid

```sql
-- Foreign key from silknote_documents to silknote_patient_filesets
ALTER TABLE `silknote_documents` 
ADD CONSTRAINT `fk_documents_patient_fileset` 
FOREIGN KEY (`patientUuid`) 
REFERENCES `silknote_patient_filesets` (`silknotePatientUuid`) 
ON DELETE CASCADE 
ON UPDATE CASCADE;
```



### Step 6: Generate UUIDs for Existing Records

```sql
-- Generate UUIDs for existing staff
UPDATE `staff` SET silknoteUserUuid = UUID() WHERE silknoteUserUuid IS NULL;

-- Generate UUIDs for existing patients
UPDATE candidates SET silknotePatientUuid = UUID() WHERE silknotePatientUuid IS NULL;

-- Generate UUIDs for existing file attachments
UPDATE ax_notes_attachments SET file_uuid = UUID() WHERE file_uuid IS NULL;
```

## Migration Complete

The VSRX database now supports Silknote Document Analysis integration. 