import type { Request, Response, Router as ExpressRouter } from 'express';
import { Router } from 'express';
// import { processQuery } from './query/query-processor.js';
import type { QueryRequest } from '../shared/types';
import config from '../config.js';

const router: ExpressRouter = Router();

export interface QueryResponse {
  success: boolean;
  error?: string;
  response?: string;
}

router.post('/', async (
  req: Request,
  res: Response<QueryResponse>
) => {
  try {
    const { query, clientFileIds } = req.body as QueryRequest;

    if (!query || !clientFileIds || !Array.isArray(clientFileIds)) {
      res.status(400).json({
        success: false,
        error: config.errors.invalidInput
      });
      return;
    }

    // const result = await processQuery(query, {
    //   clientFileIds,
    //   maxResults: context?.maxResults,
    //   minConfidence: context?.minConfidence
    // });

    res.json({
      success: true,
      response: "PLACEHOLDER"
    });

  } catch (error) {
    console.log('Query processing error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : config.errors.serverError
    });
  }
});

export default router;
