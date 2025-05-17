// Import the mapping functions
import { findEnhancedPrompt } from '../../../shared/query-mappings';
import { Request, Response } from 'express';
import * as patientService from '../services/patientService';

// Helper functions for SSE
function setupSSEHeaders(res: Response) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
}

function sendSSEMessage(res: Response, type: string, data: any) {
  res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
}

// Update the query streaming handler to use enhanced prompts when available
export async function streamSearchQueryWithEvents(req: Request, res: Response) {
  const { silknotePatientUuid } = req.params;
  const { query, includeExactQuotes, outputFormat, actualPrompt } = req.query;
  
  if (!query) {
    return res.status(400).json({ error: 'Query is required' });
  }

  try {
    const userQuery = String(query);
    
    // Get the enhanced prompt if available - use either the explicitly provided actualPrompt
    // or look up an enhanced prompt based on the query text
    const enhancedPrompt = actualPrompt ? String(actualPrompt) : findEnhancedPrompt(userQuery);
    
    // Set up SSE
    setupSSEHeaders(res);
    
    // Log if we're using an enhanced prompt
    if (enhancedPrompt) {
      console.log(`Using enhanced prompt for query: "${userQuery}"`);
      console.log(`Enhanced prompt length: ${enhancedPrompt.length} characters`);
    }

    // Start the search process with the appropriate prompt
    await patientService.streamSearchQuery(
      silknotePatientUuid, 
      enhancedPrompt || userQuery, // Use enhanced prompt if available, otherwise use original query
      res, 
      { 
        includeExactQuotes: includeExactQuotes === 'true',
        outputFormat: String(outputFormat || 'text')
      }
    );

    // Complete the response
    sendSSEMessage(res, 'done', {});
  } catch (err) {
    console.error('Error in vector search query streaming:', err);
    sendSSEMessage(res, 'error', { error: err instanceof Error ? err.message : 'Unknown error' });
  }
} 