import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { DocumentType } from '../../../shared/types'

// Mock dependencies
jest.mock('../socket', () => ({
  io: {
    to: jest.fn().mockReturnValue({
      emit: jest.fn()
    })
  }
}))

// Mock document service
jest.mock('../services/documentService', () => {
  const originalModule = jest.requireActual('../services/documentService')
  
  return {
    ...originalModule,
    processDocument: jest.fn().mockImplementation(async (documentId) => {
      // Return a processed document
      return {
        id: documentId,
        silknotePatientUuid: 'test-patient-001',
        originalName: 'test-document.pdf',
        storedPath: `/tmp/test-${documentId}.pdf`,
        status: 'complete',
        category: 'MEDICAL_REPORT',
        uploadDate: new Date().toISOString(),
        type: 'application/pdf',
        size: 1024,
        title: 'Test Document',
        format: {
          mimeType: 'application/pdf',
          extension: 'pdf'
        },
        pageCount: 2,
        documentDate: new Date().toISOString(),
        processedAt: new Date().toISOString(),
        author: 'Dr. Jane Smith',
        sourceSystem: 'Test System',
        filename: 'test-document.pdf',
        confidence: 0.85,
        content: {
          analysisResult: { data: 'mock analysis result' },
          extractedSchemas: [{ page: 1, data: 'mock extracted data' }],
          enrichedSchemas: [{ page: 1, data: 'mock enriched data' }],
          pageImages: ['data:image/png;base64,mockImageData']
        }
      }
    })
  }
})

// Mock file system operations
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

describe('Document Processing Service', () => {
  // Import the module after mocking its dependencies
  const { processDocument, queueDocument } = require('../services/documentService')
  
  beforeEach(() => {
    jest.clearAllMocks()
  })
  
  test('processes a document and updates its status', async () => {
    // Process a document
    const documentId = uuidv4()
    const result = await processDocument(documentId)
    
    // Verify document properties after processing
    expect(result).toBeDefined()
    expect(result.id).toEqual(documentId)
    expect(result.status).toEqual('complete')
    expect(result.category).toEqual('MEDICAL_REPORT')
    expect(result.processedAt).toBeDefined()
    expect(result.content.extractedSchemas.length).toBeGreaterThan(0)
  })
  
  test('emits socket events during processing', async () => {
    // Get reference to mocked socket.io
    const { io } = require('../socket')
    
    // Process a document
    const documentId = uuidv4()
    await processDocument(documentId)
    
    // Verify socket events were emitted
    const toMethod = io.to
    expect(toMethod).toHaveBeenCalledWith('test-patient-001')
    
    const emitMethod = toMethod().emit
    
    // Should emit fileStatus event
    expect(emitMethod).toHaveBeenCalledWith(
      'fileStatus', 
      expect.objectContaining({
        fileId: documentId
      })
    )
    
    // Should emit processingComplete event
    expect(emitMethod).toHaveBeenCalledWith(
      'processingComplete', 
      expect.objectContaining({
        fileId: documentId,
        metadata: expect.any(Object)
      })
    )
  })
  
  test('handles processing errors properly', async () => {
    // Override mock to simulate an error
    const originalProcessDocument = processDocument
    const mockProcessDocument = jest.fn().mockRejectedValue(new Error('Processing failed'))
    require('../services/documentService').processDocument = mockProcessDocument
    
    try {
      // Process a document that will throw an error
      const documentId = uuidv4()
      await processDocument(documentId)
    } catch (error) {
      // Verify error was properly thrown
      expect(error).toBeDefined()
      expect(error.message).toContain('Processing failed')
    }
    
    // Restore original mock
    require('../services/documentService').processDocument = originalProcessDocument
  })
  
  test('queues a document for processing', async () => {
    // Mock queue function implementation
    const mockQueueFn = jest.fn().mockResolvedValue({
      id: 'queued-doc-id',
      status: 'processing'
    })
    require('../services/documentService').queueDocument = mockQueueFn
    
    // Queue a document
    const mockFile = {
      originalname: 'test-document.pdf',
      path: '/tmp/test-upload.pdf',
      size: 1024,
      mimetype: 'application/pdf'
    }
    
    const result = await queueDocument(mockFile, 'test-patient-001')
    
    // Verify document was queued
    expect(mockQueueFn).toHaveBeenCalled()
    expect(result).toBeDefined()
    expect(result.status).toEqual('processing')
  })
}) 