// server/src/routes/vectorSearch.ts

import { Router } from 'express'
import { AzureOpenAI } from 'openai'
import config from '../config'
import * as patientService from '../services/patientService'
import { findEnhancedPrompt } from '../shared/query-mappings'

const router: Router = Router()



router.post('/:silknotePatientUuid/query', async (req, res) => {
  try {
    const { silknotePatientUuid } = req.params
    const prompt: string = `
    - You organise and concisely present information from the documents. Requests always relate to this patient, and their files - so you must always use the tool calls. 
    - You are given a list of documents that contain the patient's medical history.
    - You are also given a question from the user, a medicolegal doctor in Western Australia.
    - You need to answer the question based on the information provided in the documents.
    - Avoid duplicating information from the documents in your response, instead for instance mark them with a * and note at the bottom that there duplicates. 
    - ABSOLUTE STRICT ENFORCEMENT OF DD/MM/YYYY DATE FORMAT. THIS IS CRITICAL AND NON NEGOTIABLE.
    - NEVER EVERY WRITE GENERIC STATEMENTS LIKE "Surgical intervention", "Medication", "Treatment", etc. when you can specify WHICH intervention, medication or treatment.
    - You should use abbreviations which are appropriate for the context such as NSAIDs, ICWA, TPD, etc. You can put at the end of your response a legend of abbreviations. If it is a letter, put the full form of the abbreviation.
    - You have documents given from the vector store that you must use to answer the question, whenever creating a table or putting any information, it is imperative that you use the citations to the documents to support your answer.

    - If asked to generate a letter report, ensure to adhere to the user instructions very effectively and retrieve maximum information from the documents.

      
    User Question: ${req.body.userInstructions}
    `
    const { userInstructions } = req.body

    if (!silknotePatientUuid || !userInstructions) {
      return res.status(400).json({ error: 'Missing required parameters' })
    }

    const patient = await patientService.getPatientById(silknotePatientUuid)
    if (!patient?.vectorStore?.assistantId) {
      return res.status(404).json({ error: 'No vector store found for patient' })
    }

    const openai = new AzureOpenAI({
      apiKey: config.azure.azureOpenAI.key,
      endpoint: config.azure.azureOpenAI.endpoint,
      apiVersion: '2024-05-01-preview',
    })

    // Just create thread and start run
    const thread = await openai.beta.threads.create()
    await openai.beta.threads.messages.create(thread.id, {
      role: 'user',
      content: prompt,
    })

    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: patient.vectorStore.assistantId,
    })

    // Return immediately with thread and run IDs
    return res.json({
      success: true,
      threadId: thread.id,
      runId: run.id
    })

  } catch (error) {
    console.log('Error starting query:', error)
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
})


router.post('/:silknotePatientUuid/clear', async (req, res) => {
  try {
    const { silknotePatientUuid } = req.params

    const patient = await patientService.getPatientById(silknotePatientUuid)
    if (!patient) {
      return res.status(404).json({ error: 'Patient not found' })
    }

    if (!patient.vectorStore) {
      return res.status(404).json({ error: 'No vector store found for patient' })
    }

    const { assistantId, vectorStoreIndex } = patient.vectorStore

    const openai = new AzureOpenAI({
      apiKey: config.azure.azureOpenAI.key,
      endpoint: config.azure.azureOpenAI.endpoint,
      apiVersion: '2024-05-01-preview',
    })

    // Delete assistant if exists
    if (assistantId) {
      await openai.beta.assistants.del(assistantId)
    }

    // Delete vector store if exists
    if (vectorStoreIndex) {
      await openai.beta.vectorStores.del(vectorStoreIndex)
    }

    // Update patient removing vector store
    const updatedPatient = {
      ...patient,
      vectorStore: undefined // Remove the vector store entirely
    }

    await patientService.updatePatient(updatedPatient)

    return res.json({
      success: true,
      message: 'Vector store resources cleared successfully'
    })

  } catch (error) {
    console.log('Error clearing vector store resources:', error)
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
})

// router.get('/:silknotePatientUuid/stream', async (req, res) => {
//   const { threadId, runId } = req.query
//   const { silknotePatientUuid } = req.params

//   if (!threadId || !runId) {
//     return res.status(400).json({ error: 'Missing threadId or runId' })
//   }

//   // Set up SSE headers
//   res.setHeader('Content-Type', 'text/event-stream')
//   res.setHeader('Cache-Control', 'no-cache')
//   res.setHeader('Connection', 'keep-alive')

//   try {
//     const patient = await patientService.getPatientById(silknotePatientUuid)
//     if (!patient?.vectorStore?.assistantId) {
//       res.write(`data: ${JSON.stringify({ type: 'error', error: 'No vector store found' })}\n\n`)
//       return res.end()
//     }

//     const openai = new AzureOpenAI({
//       apiKey: config.azure.azureOpenAI.key,
//       endpoint: config.azure.azureOpenAI.endpoint,
//       apiVersion: '2024-05-01-preview',
//     })

//     // Poll for response
//     let attempts = 0
//     const maxAttempts = 60
//     const pollInterval = setInterval(async () => {
//       try {
//         const runStatus = await openai.beta.threads.runs.retrieve(
//           threadId as string,
//           runId as string
//         )

//         if (runStatus.status === 'completed') {
//           clearInterval(pollInterval)
          
//           const messages = await openai.beta.threads.messages.list(threadId as string)
//           const lastMessage = messages.data.find(m => m.role === 'assistant')

//           if (lastMessage) {
//             const textContent = lastMessage.content.find(
//               (c): c is TextContentBlock => c.type === 'text'
//             )

//             if (textContent?.text) {
//               // Send the main response
//               res.write(`data: ${JSON.stringify({ 
//                 type: 'content',
//                 content: textContent.text.value 
//               })}\n\n`)

//               // Send citations if any
//               if (textContent.text.annotations) {
//                 for (const annotation of textContent.text.annotations) {
//                   if (annotation.type === 'file_citation') {
//                     const fileMetadata = await openai.files.retrieve(
//                       annotation.file_citation.file_id
//                     )
                    
//                     // Find the document that corresponds to this file in the patient's files
//                     const document = patient.fileSet.find(
//                       (doc: MedicalDocument) => doc.clientFileId === fileMetadata.filename.split('.')[0] || 
//                              doc.originalName === fileMetadata.filename
//                     )
                    
//                     // Get the page content from the document if possible
//                     let pageImage = ''
//                     let pageNumber = 1
                    
//                     if (document && document.content.pageImages.length > 0) {
//                       // Default to the first page, but ideally we would identify the specific page
//                       pageImage = document.content.pageImages[0]
                      
//                       // Try to find the page that contains the citation text
//                       // This is a simplification - in a real implementation we'd use the Azure OCR 
//                       // results to locate the exact position
//                       if (document.content.analysisResult) {
//                         // Search through pages to find citation text
//                         const pages = document.content.analysisResult.pages || []
                        
//                         for (let i = 0; i < pages.length; i++) {
//                           // For Azure Form Recognizer, we need to check the content
//                           const pageContent = document.content.analysisResult.content || ''
//                           if (pageContent.includes(annotation.text)) {
//                             pageNumber = i + 1
//                             if (document.content.pageImages.length > i) {
//                               pageImage = document.content.pageImages[i]
//                             }
//                             break
//                           }
//                         }
//                       }
//                     }
                    
//                     res.write(`data: ${JSON.stringify({
//                       type: 'citation',
//                       citation: {
//                         quote: annotation.text,
//                         fileName: document?.originalName || fileMetadata.filename,
//                         fileId: annotation.file_citation.file_id,
//                         documentId: document?.clientFileId || '',
//                         pageNumber: pageNumber,
//                         pageImage: pageImage,
//                         citationIndex: {
//                           start: annotation.start_index,
//                           end: annotation.end_index
//                         },
//                         // Include extra information to help with highlighting
//                         extractedQuote: annotation.text,
//                         score: 1.0,
//                         fullContent: document?.content?.analysisResult?.content || ''
//                       }
//                     })}\n\n`)
//                   }
//                 }
//               }
//             }
//           }

//           res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
//           res.end()
//         } else if (runStatus.status === 'failed' || runStatus.status === 'cancelled') {
//           clearInterval(pollInterval)
//           res.write(`data: ${JSON.stringify({ 
//             type: 'error',
//             error: `Assistant run ${runStatus.status}`
//           })}\n\n`)
//           res.end()
//         }

//         attempts++
//         if (attempts >= maxAttempts) {
//           clearInterval(pollInterval)
//           res.write(`data: ${JSON.stringify({ 
//             type: 'error',
//             error: 'Query timed out after 60 seconds'
//           })}\n\n`)
//           res.end()
//         }
//       } catch (error) {
//         clearInterval(pollInterval)
//         res.write(`data: ${JSON.stringify({ 
//           type: 'error',
//           error: error instanceof Error ? error.message : 'Unknown error'
//         })}\n\n`)
//         res.end()
//       }
//     }, 1000)

//     // Handle client disconnect
//     res.on('close', () => {
//       clearInterval(pollInterval)
//     })
//   } catch (error) {
//     res.write(`data: ${JSON.stringify({ 
//       type: 'error',
//       error: error instanceof Error ? error.message : 'Unknown error'
//     })}\n\n`)
//     res.end()
//   }
// })

// Route to handle single, full query response
router.post('/:silknotePatientUuid/query-full', async (req, res) => {
  try {
    const { silknotePatientUuid } = req.params;
    // Get query from request body instead of query params
    const { query, includeExactQuotes = false, outputFormat = 'json', actualPrompt } = req.body;

    if (!silknotePatientUuid || !query) {
      return res.status(400).json({ error: 'Missing required parameters (patient UUID and query)' });
    }

    // Determine the actual prompt to use
    const userQuery = query.toString();
    const effectivePrompt = actualPrompt 
      ? actualPrompt.toString() 
      : findEnhancedPrompt(userQuery) || userQuery; // Fallback to original query

    // Call the new service function
    const result = await patientService.getQueryResponse(
      silknotePatientUuid,
      effectivePrompt, // Use the potentially enhanced prompt
      {
        includeExactQuotes: Boolean(includeExactQuotes),
        outputFormat: String(outputFormat || 'json') // Default to json for citations
      }
    );

    // Send the complete result as JSON
    res.json(result);
    return;

  } catch (error) {
    console.error('[ROUTE - /query-full] Error processing full query:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    });
    return;
  }
});

export default router