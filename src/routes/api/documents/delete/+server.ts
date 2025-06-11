import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/server/db';
import { deleteFromBlobStorage } from '$lib/server/azure-storage';
import { deleteFromVectorStore, getVectorStoreDocumentCount } from '$lib/server/vector-store';

interface DeleteRequest {
  documentUuid: string;
  patientUuid: string;
  verifyVectorStore?: boolean;
}

export const DELETE: RequestHandler = async ({ request }) => {
  try {
    const { documentUuid, patientUuid, verifyVectorStore = true }: DeleteRequest = await request.json();
    
    // Validate inputs
    if (!documentUuid || !patientUuid) {
      return json(
        { success: false, error: 'Missing required parameters' },
        { status: 400 }
      );
    }
    
    // Find the document
    const document = await prisma.silknoteDocument.findUnique({
      where: { 
        silknoteDocumentUuid: documentUuid,
        patientUuid: patientUuid // Extra safety check
      }
    });
    
    if (!document) {
      return json(
        { success: false, error: 'Document not found' },
        { status: 404 }
      );
    }
    
    const errors: string[] = [];
    
    // 1. Delete from Azure Blob Storage
    if (document.storedPath) {
      try {
        await deleteFromBlobStorage(document.storedPath);
        console.log(`Deleted blob: ${document.storedPath}`);
      } catch (error) {
        const errorMsg = `Failed to delete from blob storage: ${error instanceof Error ? error.message : 'Unknown error'}`;
        console.error(errorMsg);
        errors.push(errorMsg);
      }
    }
    
    // 2. Delete from Vector Store
    try {
      await deleteFromVectorStore(patientUuid, documentUuid);
      console.log(`Deleted from vector store: ${documentUuid}`);
    } catch (error) {
      const errorMsg = `Failed to delete from vector store: ${error instanceof Error ? error.message : 'Unknown error'}`;
      console.error(errorMsg);
      errors.push(errorMsg);
    }
    
    // 3. Delete database record
    try {
      await prisma.silknoteDocument.delete({
        where: { silknoteDocumentUuid: documentUuid }
      });
      console.log(`Deleted database record: ${documentUuid}`);
    } catch (error) {
      const errorMsg = `Failed to delete database record: ${error instanceof Error ? error.message : 'Unknown error'}`;
      console.error(errorMsg);
      errors.push(errorMsg);
      
      // If database deletion fails, this is critical
      return json(
        { 
          success: false, 
          error: errorMsg,
          partialFailures: errors 
        },
        { status: 500 }
      );
    }
    
    // 4. Verify vector store count if requested
    let vectorStoreValid = true;
    if (verifyVectorStore) {
      try {
        const remainingDocs = await prisma.silknoteDocument.count({
          where: { patientUuid: patientUuid }
        });
        
        const vectorStoreCount = await getVectorStoreDocumentCount(patientUuid);
        
        if (remainingDocs !== vectorStoreCount) {
          vectorStoreValid = false;
          errors.push(`Vector store count mismatch: DB has ${remainingDocs}, Vector Store has ${vectorStoreCount}`);
          
          // Log this error to the patient fileset
          await logErrorToPatientFileset(patientUuid, {
            timestamp: new Date().toISOString(),
            operation: 'delete',
            fileId: documentUuid,
            error: `Vector store count mismatch after deletion`,
            details: {
              dbCount: remainingDocs,
              vectorStoreCount: vectorStoreCount
            }
          });
        }
      } catch (error) {
        errors.push(`Failed to verify vector store: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
    
    // Return success with any warnings
    return json({
      success: true,
      documentUuid,
      warnings: errors,
      vectorStoreValid,
      message: errors.length > 0 
        ? 'Document deleted with some warnings' 
        : 'Document deleted successfully'
    });
    
  } catch (error) {
    console.error('Document deletion error:', error);
    return json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    );
  }
};

// Helper function to log errors to patient fileset
async function logErrorToPatientFileset(patientUuid: string, error: any) {
  try {
    const fileset = await prisma.silknotePatientFileset.findUnique({
      where: { silknotePatientUuid: patientUuid }
    });
    
    if (!fileset) return;
    
    const existingErrors = (fileset.errors as any) || {};
    const deletionErrors = existingErrors.deletionErrors || [];
    
    deletionErrors.push(error);
    
    // Keep only last 1000 deletion errors
    const trimmedErrors = deletionErrors.slice(-1000);
    
    await prisma.silknotePatientFileset.update({
      where: { silknotePatientUuid: patientUuid },
      data: {
        errors: {
          ...existingErrors,
          deletionErrors: trimmedErrors
        }
      }
    });
  } catch (err) {
    console.error('Failed to log error to patient fileset:', err);
  }
} 