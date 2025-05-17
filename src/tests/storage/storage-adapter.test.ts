import fs from 'fs'
import { v4 as uuidv4 } from 'uuid'
import { StorageType } from '../../../src/services/databaseAdapter'

// Define dummy file for testing
const createMockFile = () => ({
  originalname: 'test-document.pdf',
  path: `/tmp/test-${uuidv4()}.pdf`,
  size: 1024,
  mimetype: 'application/pdf',
  fieldname: 'file',
  encoding: '7bit',
  destination: '/tmp',
  filename: `test-${uuidv4()}.pdf`,
  buffer: Buffer.from('mock file content')
})

// Mock modules before importing the adapter
jest.mock('fs', () => {
  const originalFs = jest.requireActual('fs')
  return {
    ...originalFs,
    promises: {
      ...originalFs.promises,
      readFile: jest.fn().mockResolvedValue(Buffer.from('mock file content')),
      writeFile: jest.fn().mockResolvedValue(undefined)
    },
    existsSync: jest.fn().mockReturnValue(true),
    readFileSync: jest.fn().mockReturnValue(Buffer.from('mock file content'))
  }
})

// Create dynamic test suite for each storage type
const runTestsForStorageType = (storageType: StorageType) => {
  describe(`${storageType} Storage Adapter`, () => {
    let dbAdapter
    let mockPatientId: string
    let mockFile
    let mockDocumentId: string
  
    beforeAll(async () => {
      // Store original environment
      const originalEnv = { ...process.env }
      
      // Set environment for this storage type
      process.env.STORAGE_TYPE = storageType
      if (storageType === 'POSTGRES_PRISMA') {
        process.env.DATABASE_URL = process.env.POSTGRES_URL || 'postgresql://test_user:test_password@localhost:5432/actual_beam_test'
      } else if (storageType === 'MYSQL') {
        process.env.DATABASE_URL = process.env.MYSQL_URL || 'mysql://test_user:test_password@localhost:3306/actual_beam_test'
      }
      
      // Import adapter after setting environment variables
      const { dbAdapter: importedAdapter } = require('../../../src/services/databaseAdapter')
      dbAdapter = importedAdapter
      
      // Setup test data
      mockPatientId = `test-patient-${uuidv4()}`
      mockFile = createMockFile()
      
      // If database testing, set up schema and clean test data
      if (storageType !== 'LOCAL') {
        // Run any database setup (e.g., creating tables)
        try {
          await setupTestDatabase(storageType)
        } catch (error) {
          console.log(`Error setting up ${storageType} test database:`, error)
          throw error
        }
      }
      
      // Restore environment after imports
      process.env = originalEnv
    })
    
    beforeEach(() => {
      mockFile = createMockFile()
    })
    
    afterAll(async () => {
      // Cleanup for database tests
      if (storageType !== 'LOCAL') {
        await cleanupTestDatabase(storageType)
      }
    })
    
    test('creates file metadata and returns document', async () => {
      // Act
      const result = await dbAdapter.createFileMetadata(mockPatientId, mockFile)
      
      // Store for later tests
      mockDocumentId = result.id
      
      // Assert
      expect(result).toBeDefined()
      expect(result.id).toBeDefined()
      expect(result.silknotePatientUuid).toBe(mockPatientId)
      expect(result.originalName).toBe(mockFile.originalname)
      expect(result.status).toBe('unprocessed')
      expect(result.uploadDate).toBeDefined()
      
      // Storage-specific assertions
      if (storageType === 'LOCAL') {
        // For LOCAL storage, check that the Map was updated
        const storedDoc = await dbAdapter.getFileById(result.id)
        expect(storedDoc).toBeDefined()
      } else {
        // For database storage, check that a record was created
        // This would need to use the appropriate client for each storage type
        // and is simplified here
        const retrievedDoc = await dbAdapter.getFileById(result.id)
        expect(retrievedDoc).toBeDefined()
      }
    })
    
    test('retrieves file by ID', async () => {
      // Arrange - create a document first
      const doc = await dbAdapter.createFileMetadata(mockPatientId, mockFile)
      
      // Act
      const result = await dbAdapter.getFileById(doc.id)
      
      // Assert
      expect(result).toBeDefined()
      expect(result.id).toBe(doc.id)
      expect(result.silknotePatientUuid).toBe(mockPatientId)
      expect(result.originalName).toBe(mockFile.originalname)
    })
    
    test('retrieves file by non-existent ID returns null', async () => {
      // Act
      const result = await dbAdapter.getFileById('non-existent-id')
      
      // Assert
      expect(result).toBeNull()
    })
    
    test('updates file metadata', async () => {
      // Arrange - create a document first
      const doc = await dbAdapter.createFileMetadata(mockPatientId, mockFile)
      
      // Act
      const updates = {
        status: 'processing',
        pageCount: 10,
        author: 'Test Author'
      }
      
      await dbAdapter.updateFile(doc.id, updates)
      
      // Assert
      const updatedDoc = await dbAdapter.getFileById(doc.id)
      expect(updatedDoc).toBeDefined()
      expect(updatedDoc.status).toBe('processing')
      expect(updatedDoc.pageCount).toBe(10)
      expect(updatedDoc.author).toBe('Test Author')
    })
    
    test('deletes file by ID', async () => {
      // Arrange - create a document first
      const doc = await dbAdapter.createFileMetadata(mockPatientId, mockFile)
      
      // Verify document exists
      const beforeDelete = await dbAdapter.getFileById(doc.id)
      expect(beforeDelete).toBeDefined()
      
      // Act
      await dbAdapter.deleteFile(doc.id)
      
      // Assert
      const afterDelete = await dbAdapter.getFileById(doc.id)
      expect(afterDelete).toBeNull()
    })
    
    test('adds a pre-constructed file', async () => {
      // Arrange
      const file = {
        id: uuidv4(),
        silknotePatientUuid: mockPatientId,
        originalName: 'pre-constructed-file.pdf',
        blobUrl: '/path/to/file.pdf',
        status: 'complete',
        category: 'MEDICAL_REPORT',
        uploadDate: new Date().toISOString(),
        type: 'application/pdf',
        size: 2048,
        title: 'Pre-constructed File',
        format: {
          mimeType: 'application/pdf',
          extension: 'pdf'
        },
        pageCount: 5,
        documentDate: new Date().toISOString(),
        processedAt: new Date().toISOString(),
        author: 'Test Author',
        sourceSystem: 'Test System',
        filename: 'pre-constructed-file.pdf',
        confidence: 0.95,
        content: {
          analysisResult: { data: 'test analysis' },
          extractedSchemas: [{ page: 1, data: 'test schema' }],
          enrichedSchemas: [{ page: 1, data: 'test enrichment' }],
          pageImages: []
        }
      }
      
      // Act
      await dbAdapter.addFile(file)
      
      // Assert
      const retrievedFile = await dbAdapter.getFileById(file.id)
      expect(retrievedFile).toBeDefined()
      expect(retrievedFile.id).toBe(file.id)
      expect(retrievedFile.title).toBe(file.title)
      expect(retrievedFile.author).toBe(file.author)
      expect(retrievedFile.content.analysisResult).toEqual(file.content.analysisResult)
    })
  })
}

// Helper functions for database setup and cleanup
async function setupTestDatabase(storageType: StorageType): Promise<void> {
  if (storageType === 'POSTGRES_PRISMA') {
    // Setup PostgreSQL schema if needed
    // This would typically use the Prisma client
    console.log('Setting up PostgreSQL test database schema')
  } else if (storageType === 'MYSQL') {
    // Setup MySQL schema if needed
    // This would typically use mysql2/promise
    console.log('Setting up MySQL test database schema')
  }
}

async function cleanupTestDatabase(storageType: StorageType): Promise<void> {
  if (storageType === 'POSTGRES_PRISMA') {
    // Cleanup PostgreSQL test data
    console.log('Cleaning up PostgreSQL test data')
  } else if (storageType === 'MYSQL') {
    // Cleanup MySQL test data
    console.log('Cleaning up MySQL test data')
  }
}

// Run tests for each storage type
describe('Storage Adapter Tests', () => {
  // Only run tests for the storage type specified in environment, or all if not specified
  const storageTypes: StorageType[] = (process.env.STORAGE_TYPE as StorageType) 
    ? [process.env.STORAGE_TYPE as StorageType]
    : ['LOCAL', 'POSTGRES_PRISMA', 'MYSQL']
  
  storageTypes.forEach(runTestsForStorageType)
}) 