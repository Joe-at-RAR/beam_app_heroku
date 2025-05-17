import fs from 'fs';
import path from 'path';
import { analyzeDocument } from '../services/documentAnalyzer';
import { PatientDetails } from '@shared/types';

/**
 * This is a basic test script to demonstrate how the split extraction works.
 * It loads a sample PDF and runs it through the analyzer to verify the 4-part parallel extraction process.
 */
async function runSplitExtractionTest() {
  console.log('Starting 4-part split extraction test...');
  
  try {
    // Path to a sample PDF file - modify this to a valid path
    const samplePdfPath = path.join(__dirname, '../../../sample_data/test_document.pdf');
    
    if (!fs.existsSync(samplePdfPath)) {
      console.log(`Test PDF not found at: ${samplePdfPath}`);
      console.log('Please place a sample PDF at this location or modify the path.');
      return;
    }
    
    // Load the PDF file
    const pdfBuffer = fs.readFileSync(samplePdfPath);
    console.log(`Loaded sample PDF: ${samplePdfPath} (${pdfBuffer.length} bytes)`);
    
    // Create a documentId for the test
    const documentId = `test_${Date.now()}`;
    
    // Create a patient context object that matches the PatientDetails interface
    const patientContext: PatientDetails = {
      id: 'test-patient-001',
      name: 'John Doe',
      dateOfBirth: '01/01/1980',
      gender: 'Male',
      silknoteUserUuid: 'test-user-001',
      fileSet: [] // Empty array of medical documents
    };
    
    // Run the analyzer with 4-part split extraction
    console.log('Running document analyzer with 4-part split extraction...');
    const result = await analyzeDocument({
      documentId,
      buffer: pdfBuffer,
      patientContext
    });
    
    // Log results summary
    console.log('\nAnalysis Results Summary:');
    console.log('-------------------------');
    console.log(`Document ID: ${result.id}`);
    console.log(`Title: ${result.title}`);
    console.log(`Category: ${result.category}`);
    console.log(`Confidence: ${result.confidence}`);
    console.log(`Page Count: ${result.pageCount}`);
    
    // Check extraction completeness
    const extractedSchemas = result.content?.extractedSchemas || [];
    console.log(`\nExtracted ${extractedSchemas.length} pages`);
    
    // Check some key fields to verify the split worked correctly
    extractedSchemas.forEach((schema, index) => {
      console.log(`\nPage ${index + 1}:`);
      
      // Check Part 1 fields (Document Metadata and Patient Information)
      console.log('Part 1 Fields:');
      console.log(`- Document Title: ${schema.documentTitle || 'N/A'}`);
      console.log(`- Document Date: ${schema.documentDate || 'N/A'}`);
      console.log(`- Patient: ${schema.patient ? 'Present' : 'Not present'}`);
      console.log(`- Author: ${schema.author ? 'Present' : 'Not present'}`);
      
      // Check Part 2 fields (Clinical Content only)
      console.log('Part 2 Fields:');
      console.log(`- Clinical Content: ${schema.clinicalContent ? 'Present' : 'Not present'}`);
      if (schema.clinicalContent) {
        console.log(`  - Diagnoses: ${schema.clinicalContent.diagnosis?.length || 0} items`);
        console.log(`  - Treatments: ${schema.clinicalContent.treatments?.length || 0} items`);
        console.log(`  - Medications: ${schema.clinicalContent.medications?.length || 0} items`);
        console.log(`  - Allergies: ${schema.clinicalContent.allergies?.length || 0} items`);
      }
      
      // Check Part 3 fields (Work Capacity, Employment and Injury Information)
      console.log('Part 3 Fields:');
      console.log(`- Work Capacity: ${schema.workCapacity ? 'Present' : 'Not present'}`);
      console.log(`- Employment: ${schema.employment ? 'Present' : 'Not present'}`);
      console.log(`- Injury: ${schema.injury ? 'Present' : 'Not present'}`);
      console.log(`- Insurer: ${schema.insurer ? 'Present' : 'Not present'}`);
      
      // Check Part 4 fields (Procedures, Recommendations and Events)
      console.log('Part 4 Fields:');
      console.log(`- Procedures: ${schema.procedure?.length || 0} items`);
      console.log(`- Imaging: ${schema.imaging ? 'Present' : 'Not present'}`);
      console.log(`- Recommendations: ${schema.recommendations ? 'Present' : 'Not present'}`);
      console.log(`- Conclusions: ${schema.conclusions ? 'Present' : 'Not present'}`);
      console.log(`- Contact Information: ${schema.contactInformation ? 'Present' : 'Not present'}`);
      console.log(`- Key Events: ${schema.keyEvents?.length || 0} items`);
    });
    
    console.log('\nTest completed successfully!');
  } catch (error) {
    console.log('Test failed with error:', error);
  }
}

// Run the test when executed directly
if (require.main === module) {
  runSplitExtractionTest().catch(console.log);
}

export { runSplitExtractionTest }; 