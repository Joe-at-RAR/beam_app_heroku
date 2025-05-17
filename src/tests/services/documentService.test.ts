import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { documentService } from '../../services/documentService';

// Define DocumentType enum locally to avoid import issues
enum DocumentType {
  UNKNOWN = 'UNKNOWN',
  MEDICAL_REPORT = 'MEDICAL_REPORT',
  LAB_RESULT = 'LAB_RESULT',
  IMAGING = 'IMAGING',
  PRESCRIPTION = 'PRESCRIPTION',
  REFERRAL = 'REFERRAL',
  UNPROCESSED = 'UNPROCESSED'
}

// Mock dependencies
jest.mock('../../socket', () => ({
  io: {
    to: jest.fn().mockReturnValue({
      emit: jest.fn()
    })
  }
}));

// Mock file system operations
jest.mock('fs', () => {
  const originalFs = jest.requireActual('fs');
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
});

// Mock patient service
jest.mock('../../services/patientService', () => ({
  getPatients: jest.fn().mockResolvedValue([
    {
      id: 'test-patient-001',
      name: 'Test Patient',
      fileSet: [
        {
          id: 'test-doc-001',
          silknotePatientUuid: 'test-patient-001',
          title: 'Test Document',
          content: {
            analysisResult: { mock: 'data' },
            extractedSchemas: [{ page: 1, data: 'test' }],
            enrichedSchemas: [{ data: 'test' }],
            pageImages: ['data:image/png;base64,test']
          }
        }
      ]
    }
  ]),
  updateFileForPatient: jest.fn().mockResolvedValue(true)
}));

// Mock document analyzer
jest.mock('../../services/documentAnalyzer', () => ({
  analyzeDocument: jest.fn().mockResolvedValue({
    id: 'analyzed-doc-001',
    silknotePatientUuid: 'test-patient-001',
    title: 'Analyzed Document',
    status: 'processed',
    category: DocumentType.MEDICAL_REPORT,
    content: {
      analysisResult: { mock: 'analysis data' },
      extractedSchemas: [{ page: 1, type: 'test' }],
      enrichedSchemas: [{ type: 'test' }],
      pageImages: []
    }
  })
}));

// Mock rate limiter
jest.mock('../../services/centralRateLimiter', () => ({
  consume: jest.fn().mockResolvedValue({ remainingPoints: 10 }),
  executeWithRetry: jest.fn().mockImplementation((fn) => fn())
}));

describe('Document Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getDocumentById', () => {
    test('returns document when found', async () => {
      // Call the service method
      const result = await documentService.getDocumentById('test-doc-001');
      
      // Verify result
      expect(result).toBeDefined();
      expect(result?.id).toBe('test-doc-001');
      expect(result?.silknotePatientUuid).toBe('test-patient-001');
      expect(result?.title).toBe('Test Document');
    });
    
    test('returns null when document not found', async () => {
      // Call the service method with non-existent ID
      const result = await documentService.getDocumentById('non-existent-doc');
      
      // Verify result is null
      expect(result).toBeNull();
    });
  });

  describe('getDocumentContent', () => {
    test('returns document content when found', async () => {
      // Call the service method
      const result = await documentService.getDocumentContent('test-doc-001');
      
      // Verify result
      expect(result).toBeDefined();
      expect(result.analysisResult).toBeDefined();
      expect(result.extractedSchemas).toHaveLength(1);
      expect(result.enrichedSchemas).toHaveLength(1);
      expect(result.pageImages).toHaveLength(1);
    });
    
    test('returns null when document content not found', async () => {
      // Call the service method with non-existent ID
      const result = await documentService.getDocumentContent('non-existent-doc');
      
      // Verify result is null
      expect(result).toBeNull();
    });
  });

  describe('queueDocument', () => {
    test('queues document for processing', async () => {
      // Create a mock document
      const mockBuffer = Buffer.from('test file content');
      const mockPartialDoc = {
        id: 'queue-test-doc',
        silknotePatientUuid: 'test-patient-001',
        title: 'Queue Test Document',
        originalName: 'test.pdf',
        type: 'application/pdf'
      };
      const mockPatientContext = {
        id: 'test-patient-001',
        name: 'Test Patient'
      };
      
      // Call queueDocument
      await documentService.queueDocument({
        buffer: mockBuffer,
        partialDoc: mockPartialDoc,
        patientContext: mockPatientContext
      });
      
      // Get socket reference
      const { io } = require('../../socket');
      
      // Check if socket.emit was called with fileStatus event
      const toMethod = io.to;
      expect(toMethod).toHaveBeenCalledWith('test-patient-001');
      
      const emitMethod = toMethod().emit;
      expect(emitMethod).toHaveBeenCalledWith(
        'fileStatus',
        expect.objectContaining({
          fileId: 'queue-test-doc',
          status: 'queued'
        })
      );
    });
    
    test('adds missing fields to partial document', async () => {
      // Create a minimal mock document
      const mockBuffer = Buffer.from('test file content');
      const mockPartialDoc = {
        id: 'minimal-doc',
        silknotePatientUuid: 'test-patient-001'
      };
      const mockPatientContext = {
        id: 'test-patient-001',
        name: 'Test Patient'
      };
      
      // Call queueDocument
      await documentService.queueDocument({
        buffer: mockBuffer,
        partialDoc: mockPartialDoc,
        patientContext: mockPatientContext
      });
      
      // Get socket reference
      const { io } = require('../../socket');
      const emitMethod = io.to().emit;
      
      // Check if document was enhanced with missing fields
      expect(emitMethod).toHaveBeenCalledWith(
        'fileStatus',
        expect.objectContaining({
          fileId: 'minimal-doc',
          status: 'queued',
          metadata: expect.objectContaining({
            hash: expect.any(String),
            storedPath: expect.stringContaining('minimal-doc')
          })
        })
      );
    });
  });
  
  describe('rate limiting', () => {
    test('applies rate limiting', async () => {
      // Override the mock to simulate limit reached
      require('../../services/centralRateLimiter').consume.mockRejectedValueOnce({
        remainingPoints: 0,
        msBeforeNext: 1000
      });
      
      // Create a mock document
      const mockBuffer = Buffer.from('test file content');
      const mockPartialDoc = {
        id: 'rate-limited-doc',
        silknotePatientUuid: 'test-patient-001'
      };
      const mockPatientContext = {
        id: 'test-patient-001',
        name: 'Test Patient'
      };
      
      // Call queueDocument and expect it to be rate limited
      try {
        await documentService.queueDocument({
          buffer: mockBuffer,
          partialDoc: mockPartialDoc,
          patientContext: mockPatientContext
        });
        
        // Should not reach here
        fail('Should have thrown rate limit error');
      } catch (error) {
        // Verify error is rate limit error
        expect(error.message).toContain('rate limit');
      }
    });
  });
}); 