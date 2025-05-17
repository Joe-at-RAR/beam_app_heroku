import { v4 as uuidv4 } from 'uuid';
import { analyzeDocument } from '../../services/documentAnalyzer';

// Define DocumentType enum locally to avoid import errors
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
jest.mock('fs', () => {
  const originalFs = jest.requireActual('fs');
  return {
    ...originalFs,
    promises: {
      ...originalFs.promises,
      writeFile: jest.fn().mockResolvedValue(undefined),
      readFile: jest.fn().mockResolvedValue(Buffer.from('test content'))
    }
  };
});

// Mock PDF parser
jest.mock('@pdf-lib/pdf', () => ({
  PDFDocument: {
    load: jest.fn().mockResolvedValue({
      getPageCount: jest.fn().mockReturnValue(3),
      getPage: jest.fn().mockReturnValue({
        getText: jest.fn().mockReturnValue('Sample medical report. Patient: John Doe. Date: 2023-01-01'),
        extractText: jest.fn().mockReturnValue('Sample medical report. Patient: John Doe. Date: 2023-01-01')
      })
    })
  }
}));

// Mock form recognizer
jest.mock('@azure/ai-form-recognizer', () => {
  return {
    DocumentAnalysisClient: jest.fn().mockImplementation(() => ({
      beginAnalyzeDocument: jest.fn().mockImplementation(() => ({
        pollUntilDone: jest.fn().mockResolvedValue({
          pages: [
            { pageNumber: 1, lines: [{ content: 'Sample medical report' }] },
            { pageNumber: 2, lines: [{ content: 'Page 2 content' }] },
            { pageNumber: 3, lines: [{ content: 'Page 3 content' }] }
          ],
          tables: [
            { 
              cells: [
                { content: 'Name', rowIndex: 0, columnIndex: 0 },
                { content: 'John Doe', rowIndex: 0, columnIndex: 1 }
              ]
            }
          ],
          documents: [
            { docType: 'medical_report', fields: { date: { content: '2023-01-01' } } }
          ]
        })
      }))
    }))
  };
});

describe('Document Analyzer Service', () => {
  const testDocumentId = `test-doc-${uuidv4()}`;
  const testPatientId = `test-patient-${uuidv4()}`;
  const testBuffer = Buffer.from('%PDF-1.4 test PDF content');
  
  // Test input for analyzer
  const analyzerInput = {
    documentId: testDocumentId,
    buffer: testBuffer,
    silknotePatientUuid: testPatientId,
    partialDoc: {
      id: testDocumentId,
      silknotePatientUuid: testPatientId,
      originalName: 'test-document.pdf',
      content: {
        pageImages: ['data:image/png;base64,testImageData']
      }
    }
  };
  
  test('analyzes PDF document and extracts metadata', async () => {
    // Analyze document
    const result = await analyzeDocument(analyzerInput);
    
    // Verify result properties
    expect(result).toBeDefined();
    expect(result.id).toBe(testDocumentId);
    expect(result.silknotePatientUuid).toBe(testPatientId);
    expect(result.pageCount).toBe(3);
    expect(result.status).toBe('processed');
    expect(result.processedAt).toBeDefined();
  });
  
  test('extracts document category based on content', async () => {
    // Analyze document
    const result = await analyzeDocument(analyzerInput);
    
    // Verify document category
    expect(result.category).toBeDefined();
    expect(result.category).toBe(DocumentType.MEDICAL_REPORT);
  });
  
  test('extracts document date from content', async () => {
    // Analyze document
    const result = await analyzeDocument(analyzerInput);
    
    // Verify document date
    expect(result.documentDate).toBeDefined();
    expect(result.documentDate).toContain('2023-01-01');
  });
  
  test('stores analysis results in document content', async () => {
    // Analyze document
    const result = await analyzeDocument(analyzerInput);
    
    // Verify analysis results are stored
    expect(result.content).toBeDefined();
    expect(result.content.analysisResult).toBeDefined();
    expect(result.content.extractedSchemas).toBeDefined();
    expect(result.content.extractedSchemas.length).toBe(3); // One per page
    expect(result.content.enrichedSchemas).toBeDefined();
    expect(result.content.enrichedSchemas.length).toBeGreaterThan(0);
  });
  
  test('preserves existing page images', async () => {
    // Analyze document
    const result = await analyzeDocument(analyzerInput);
    
    // Verify page images are preserved
    expect(result.content.pageImages).toBeDefined();
    expect(result.content.pageImages.length).toBe(1);
    expect(result.content.pageImages[0]).toBe('data:image/png;base64,testImageData');
  });
  
  test('calculates document confidence score', async () => {
    // Analyze document
    const result = await analyzeDocument(analyzerInput);
    
    // Verify confidence score
    expect(result.confidence).toBeDefined();
    expect(typeof result.confidence).toBe('number');
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });
  
  test('handles documents with missing fields', async () => {
    // Create input with minimal information
    const minimalInput = {
      documentId: testDocumentId,
      buffer: testBuffer,
      silknotePatientUuid: testPatientId,
      partialDoc: {
        id: testDocumentId,
        silknotePatientUuid: testPatientId
      }
    };
    
    // Analyze document
    const result = await analyzeDocument(minimalInput);
    
    // Verify result has all required fields
    expect(result.id).toBe(testDocumentId);
    expect(result.silknotePatientUuid).toBe(testPatientId);
    expect(result.originalName).toBeDefined();
    expect(result.status).toBe('processed');
    expect(result.content).toBeDefined();
    expect(result.processedAt).toBeDefined();
  });
}); 