import { AzureOpenAI } from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources';
import config from "../config";
import { tokenRateLimiter } from './rateLimiter';
import zodToJsonSchema from 'zod-to-json-schema';
import { prepareJsonSchema } from '../utils/schemaUtils';
import { createLogger } from '../utils/logger'

// LLM_ORCHESTRATION process logging via centralized logger
const logger = createLogger('LLM_ORCHESTRATION')

// Export tokenRateLimiter for use in other services
export { tokenRateLimiter };

// Create a mock client for development if Azure credentials are missing
let openAIClient: AzureOpenAI;
let openaiclientlogic: AzureOpenAI; // Second client for reasoning_effort handling
let model: string = '';
let modelCS: string = ''; // Model for the second client


  try {
    // Initialize Azure OpenAI client with the latest approach
    openAIClient = new AzureOpenAI({
      apiKey: config.azure.azureOpenAI.key,
      endpoint: config.azure.azureOpenAI.endpoint,
      deployment: config.azure.azureOpenAI.deployment,
      apiVersion: "2024-12-01-preview",
    });
    
    // Initialize second Azure OpenAI client for reasoning_effort
    openaiclientlogic = new AzureOpenAI({
      apiKey: config.azure.azureOpenAI.key,
      endpoint: config.azure.azureOpenAI.endpoint,
      deployment: config.azure.azureOpenAI.deployment, // Use deploymentCS if available, fallback to regular deployment
      apiVersion: "2025-01-01-preview",
    });
    
    model = config.azure.azureOpenAI.deployment;
    
    logger.info('[LLM SERVICE] Successfully initialized Azure OpenAI clients');
    logger.info('[LLM SERVICE] Models:', { 
      main: model, 
    });
  } catch (error) {
    logger.error('[LLM SERVICE] Failed to initialize Azure OpenAI clients:', error);
    // Create a mock client for development
 //   createMockClient();
  }


export { openAIClient, openaiclientlogic, model, modelCS };

/**
 * Centralized function for generating structured JSON using Azure OpenAI client directly.
 * This function should be used instead of directly calling OpenAI APIs to ensure consistent error handling.
 */

export interface StructuredOutputResult {
  result: any;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/**
 * Generates structured output using Azure OpenAI's direct client
 * 
 * @param systemPrompt - System message for the AI
 * @param userPrompt - User message/query
 * @param schema - JSON schema to use for validation (optional)
 * @returns The structured output and token usage information
 */
export async function generateStructuredOutput(
  systemPrompt: string,
  userPrompt: string,
  schema?: any,
): Promise<StructuredOutputResult> {
 
  
  // Estimate and track tokens
  const promptTokens = tokenRateLimiter.estimateTokens(systemPrompt + userPrompt);
  //logger.appDebug(`[LLM SERVICE] task - Estimated tokens: ${promptTokens}`);
  await tokenRateLimiter.trackTokens(promptTokens);
  
  try {
    //logger.appDebug(`[LLM SERVICE] Executing task`);
    
    // Create the messages array
    const messages: Array<ChatCompletionMessageParam> = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ];
    
    // For Azure OpenAI API, we need to use the extended parameters format
    const azureParams: any = {
      messages,
      model,
    };
    
    // Use schema for validation if provided, otherwise use json_object format
    if (schema) {
      // First convert the schema if it's a Zod schema
      let schemaJson = schema._def ? zodToJsonSchema(schema,{ $refStrategy:'none', target:'jsonSchema7' }) : schema
      if (!schemaJson.type) schemaJson.type = "object"
      const prepared = prepareJsonSchema(schemaJson)
      
      azureParams.response_format = { 
        type: "json_schema",
        json_schema: {
          name: "structured_output",
          schema: prepared
        }
      };
    } else {
      azureParams.response_format = { 
        type: "json_object"
      };
    }
    
    // Use the new client's chat completions API
    const response = await openAIClient.chat.completions.create(azureParams);
    
    let resultJson;
    if (response.choices && response.choices.length > 0) {
      try {
        resultJson = JSON.parse(response.choices[0].message?.content || '{}');
      } catch (err) {
        logger.error(`[LLM SERVICE] Error parsing JSON response: ${err}`);
        resultJson = {};
      }
    }
    
    // Track actual tokens used
    if (response.usage) {
     // logger.appDebug(`[LLM SERVICE] used ${response.usage.total_tokens} tokens`);
    }
    
    return {
      result: resultJson,
      usage: {
        prompt_tokens: response.usage?.prompt_tokens,
        completion_tokens: response.usage?.completion_tokens,
        total_tokens: response.usage?.total_tokens
      }
    };
  } catch (error: any) {
    // Enhanced error logging
    const errorObj = {
      message: error.message || 'Unknown error',
      status: error.statusCode || error.status || (error.data?.error?.code),
      type: error.type || error.code || 'UnknownErrorType'
    };
    
    logger.error(`[LLM SERVICE] error: ${JSON.stringify(errorObj, null, 2)}`);
    throw error;
  }
}




