/**
 * Utility functions for preparing schemas for the Azure OpenAI API
 */

/**
 * Prepares a JSON schema for use with Azure OpenAI API
 * - Removes $schema property if present
 * - Ensures type is set to "object"
 * - Marks all properties as required using __required
 * - Sets additionalProperties to false
 * - Recursively processes nested properties
 * 
 * @param schema - The JSON schema to prepare
 * @returns The prepared schema
 */
export function prepareJsonSchema(schema: any): any {
  // If schema is null or undefined, create a basic object schema
  if (!schema) {
    return {
      type: "object", 
      properties: {},
      __required: [],
      additionalProperties: false
    };
  }
  
  // Remove $schema if it exists - it's not needed for Azure OpenAI
  if (schema.$schema) {
    delete schema.$schema;
  }
  
  // Ensure the schema has a type (default to object)
  if (!schema.type) {
    schema.type = "object";
  }
  
  if (schema.type === 'object' && schema.properties) {
    // Use __required instead of required to avoid conflicts with existing fields
    schema.__required = Object.keys(schema.properties);
    schema.additionalProperties = false;
    
    // Process nested properties
    Object.keys(schema.properties).forEach(key => {
      if (schema.properties[key].type === 'object') {
        schema.properties[key] = prepareJsonSchema(schema.properties[key]);
      } else if (schema.properties[key].type === 'array' && 
                schema.properties[key].items && 
                schema.properties[key].items.type === 'object') {
        schema.properties[key].items = prepareJsonSchema(schema.properties[key].items);
      }
    });
  }
  
  return schema;
} 