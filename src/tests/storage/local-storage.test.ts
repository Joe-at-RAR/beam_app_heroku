import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

// Set storage type to LOCAL for testing
process.env.STORAGE_TYPE = 'LOCAL';

// Import storage service after setting environment
const { storageService } = require('../../utils/storage');

describe('Local Storage Service', () => {
  const testDocumentId = `test-doc-${uuidv4()}`;
  const testPatientId = `test-patient-${uuidv4()}`;
  const testBuffer = Buffer.from('Test document content');
  const testMetadata = {
    documentId: testDocumentId,
    silknotePatientUuid: testPatientId,
    originalName: 'test-document.pdf',
    mimeType: 'application/pdf',
    size: testBuffer.length,
    uploadDate: new Date().toISOString()
  };

  afterAll(async () => {
    // Clean up test data
    try {
      await storageService.deleteDocument(testDocumentId);
    } catch (error) {
      console.log('Error cleaning up test document:', error);
    }
  });

  test('initializes local storage correctly', () => {
    expect(storageService).toBeDefined();
    expect(storageService.type).toBe('LOCAL');
    expect(storageService.storeDocument).toBeDefined();
    expect(storageService.getDocument).toBeDefined();
    expect(storageService.deleteDocument).toBeDefined();
  });

  test('stores document and metadata', async () => {
    // Store test document
    const storedPath = await storageService.storeDocument(
      testDocumentId,
      testBuffer,
      testMetadata
    );

    // Verify stored path is returned
    expect(storedPath).toBeDefined();
    expect(typeof storedPath).toBe('string');
    expect(storedPath).toContain(testDocumentId);
  });

  test('retrieves stored document', async () => {
    // Retrieve test document
    const retrievedDocument = await storageService.getDocument(testDocumentId);
    
    // Verify document content and metadata
    expect(retrievedDocument).toBeDefined();
    expect(retrievedDocument.buffer).toEqual(testBuffer);
    expect(retrievedDocument.metadata).toEqual(expect.objectContaining({
      documentId: testDocumentId,
      silknotePatientUuid: testPatientId
    }));
  });

  test('retrieves metadata for document', async () => {
    // Retrieve metadata only
    const metadata = await storageService.getDocumentMetadata(testDocumentId);
    
    // Verify metadata
    expect(metadata).toBeDefined();
    expect(metadata.documentId).toBe(testDocumentId);
    expect(metadata.silknotePatientUuid).toBe(testPatientId);
    expect(metadata.originalName).toBe('test-document.pdf');
    expect(metadata.size).toBe(testBuffer.length);
  });

  test('lists documents for patient', async () => {
    // Store another document for same patient
    const secondDocId = `test-doc-${uuidv4()}`;
    await storageService.storeDocument(
      secondDocId,
      testBuffer,
      {
        ...testMetadata,
        documentId: secondDocId
      }
    );
    
    // List documents for patient
    const patientDocs = await storageService.listDocumentsForPatient(testPatientId);
    
    // Verify list includes both documents
    expect(patientDocs).toBeDefined();
    expect(Array.isArray(patientDocs)).toBe(true);
    expect(patientDocs.length).toBeGreaterThanOrEqual(2);
    
    // Verify document IDs are in the list
    const docIds = patientDocs.map(doc => doc.documentId);
    expect(docIds).toContain(testDocumentId);
    expect(docIds).toContain(secondDocId);
    
    // Clean up second test document
    await storageService.deleteDocument(secondDocId);
  });

  test('deletes document', async () => {
    // Delete test document
    await storageService.deleteDocument(testDocumentId);
    
    // Verify document no longer exists
    try {
      await storageService.getDocument(testDocumentId);
      expect(true).toBe(false); // This will fail the test
    } catch (error) {
      expect(error).toBeDefined();
      expect(error.message).toContain('not found');
    }
  });

  test('handles non-existent document retrieval', async () => {
    // Try to retrieve non-existent document
    try {
      await storageService.getDocument('non-existent-doc-id');
      expect(true).toBe(false); // This will fail the test
    } catch (error) {
      expect(error).toBeDefined();
      expect(error.message).toContain('not found');
    }
  });

  test('handles concurrent storage operations', async () => {
    // Create arrays to store promises and document IDs
    const docPromises: Promise<string>[] = [];
    const docIds: string[] = [];
    
    for (let i = 0; i < 5; i++) {
      const docId = `concurrent-test-${i}-${uuidv4()}`;
      docIds.push(docId);
      
      // Store document
      docPromises.push(
        storageService.storeDocument(
          docId,
          testBuffer,
          {
            ...testMetadata,
            documentId: docId
          }
        )
      );
    }
    
    // Wait for all storage operations to complete
    await Promise.all(docPromises);
    
    // Verify all documents were stored
    const retrievePromises = docIds.map(docId => 
      storageService.getDocumentMetadata(docId)
    );
    
    const results = await Promise.all(retrievePromises);
    
    // All results should have expected metadata
    for (let i = 0; i < results.length; i++) {
      expect(results[i].documentId).toBe(docIds[i]);
      expect(results[i].silknotePatientUuid).toBe(testPatientId);
    }
    
    // Clean up test documents
    await Promise.all(docIds.map(docId => 
      storageService.deleteDocument(docId)
    ));
  });
}); 