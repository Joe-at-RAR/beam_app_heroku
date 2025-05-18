import type { EnrichedExtraction, EnrichedField, EnrichedExtractionPosition } from '../../shared/types'
import type { AnalyzeResult, DocumentPage } from '@azure/ai-form-recognizer'

// Returns a bounding box given a polygon array.
export function getPolygonBoundingBox(polygon?: { x: number; y: number }[]): { x: number; y: number; width: number; height: number } | null {
  if (!polygon || polygon.length < 4) return null
  
  // Log the original polygon to understand the coordinate system
 // console.log('POLYGON COORDINATES:', JSON.stringify(polygon));
  
  const x = polygon[0].x
  const y = polygon[0].y
  const width = polygon[1].x - polygon[0].x
  const height = polygon[2].y - polygon[0].y
  
  // Log the resulting bounding box to understand the transformation
  //console.log('CALCULATED BOUNDING BOX:', JSON.stringify({ x, y, width, height }));
  
  return { x, y, width, height }
}

// Since the page comes directly from analysisResult, use it directly.
export function findAllTextLocations(text: string, _analysisResult: AnalyzeResult, page: DocumentPage): EnrichedExtractionPosition[] {
  const locations: EnrichedExtractionPosition[] = []
  // Use the page parameter directly because it carries all necessary azure info.
  if (page.words) {
    for (const word of page.words) {
      if (word.content && word.content.includes(text)) {
        const box = getPolygonBoundingBox(word.polygon)
        if (box) {
          locations.push({ boundingBox: box, pageNumber: page.pageNumber, confidence: word.confidence || 0 })
        }
      }
    }
  }
  if (page.lines) {
    for (const line of page.lines) {
      if (line.content && line.content.includes(text)) {
        const box = getPolygonBoundingBox(line.polygon)
        if (box) {
          locations.push({ boundingBox: box, pageNumber: page.pageNumber, confidence: 1.0 })
        }
      }
    }
  }
  return locations
}

// Wraps a string value into an EnrichedField with positional data.
export function enrichStringField(value: string, analysisResult: AnalyzeResult, page: DocumentPage): EnrichedField {
  // Skip position finding for single-digit values
  if (value.length === 1 && /^\d$/.test(value)) {
    return { value }
  }
  
  const positions = findAllTextLocations(value, analysisResult, page)
    .map(location => {
      // Explicitly construct the positional object.
      return { boundingBox: location.boundingBox, pageNumber: page.pageNumber, confidence: location.confidence }
    })
  return positions.length > 0 ? { value, positions } : { value }
}

/**
 * Aligns sibling enriched fields (direct properties of an object) so that they share a common number
 * of positions. For each property whose positions array length is larger than the minimum among siblings,
 * the array is truncated. Moreover, if the minimum is more than one, the aligned position selected is the one
 * for which the positions across all keys are closest to the first key's first position.
 */
function alignSiblingEnrichedFields(fields: Record<string, EnrichedField>): Record<string, EnrichedField> {
  const keys = Object.keys(fields)
  let minCount = Infinity
  for (const key of keys) {
    const count = fields[key].positions ? fields[key].positions!.length : 0
    minCount = Math.min(minCount, count)
  }
  if (minCount === Infinity || minCount === 0) {
    for (const key of keys) {
      fields[key] = { ...fields[key], positions: [] }
    }
    return fields
  }
  // If minCount is 1, simply keep the first entry.
  if (minCount === 1) {
    for (const key of keys) {
      fields[key] = { ...fields[key], positions: [fields[key].positions![0]] }
    }
    return fields
  }
  // When minCount > 1, choose the index with positions closest to the first field's first position.
  const firstKey = keys[0]
  let bestIndex = 0
  let bestDistance = Infinity
  for (let i = 0; i < minCount; i++) {
    let totalDistance = 0
    const firstPos = fields[firstKey].positions![0]
    for (const key of keys) {
      const pos = fields[key].positions![i]
      const dx = pos.boundingBox.x - firstPos.boundingBox.x
      const dy = pos.boundingBox.y - firstPos.boundingBox.y
      totalDistance += Math.sqrt(dx * dx + dy * dy)
    }
    if (totalDistance < bestDistance) {
      bestDistance = totalDistance
      bestIndex = i
    }
  }
  for (const key of keys) {
    fields[key] = { ...fields[key], positions: [fields[key].positions![bestIndex]] }
  }
  return fields
}

// Recursively processes any input value ensuring that every string (and primitive)
// is converted into an EnrichedField. At an object final layer (where all properties are EnrichedField),
// the positions arrays are aligned.
export function enrichExtractionRecursively(data: any, analysisResult: AnalyzeResult, page: DocumentPage): EnrichedExtraction {
  if (typeof data === 'string') {
    return enrichStringField(data, analysisResult, page)
  }
  if (typeof data === 'number' || typeof data === 'boolean') {
    return enrichStringField(data.toString(), analysisResult, page)
  }
  if (Array.isArray(data)) {
    return data.map(item => enrichExtractionRecursively(item, analysisResult, page))
  }
  if (typeof data === 'object' && data !== null) {
    const enriched: { [key: string]: EnrichedExtraction } = {}
    for (const key in data) {
      enriched[key] = data[key] === null ? null : enrichExtractionRecursively(data[key], analysisResult, page)
    }
    // Check if all properties are EnrichedField (i.e. have a "value" property).
    const keys = Object.keys(enriched)
    if (keys.length > 0 && keys.every(k => typeof enriched[k] === 'object' && enriched[k] !== null && 'value' in (enriched[k] as EnrichedField))) {
      return alignSiblingEnrichedFields(enriched as Record<string, EnrichedField>)
    }
    return enriched
  }
  return enrichStringField("", analysisResult, page)
}

// Processes the raw extraction by converting every field into its enriched form
// and appending a _metadata property.
export function processExtraction(rawExtraction: any, analysisResult: AnalyzeResult, page: DocumentPage): { [key: string]: EnrichedExtraction } {
  const enriched = enrichExtractionRecursively(rawExtraction, analysisResult, page) as { [key: string]: EnrichedExtraction }
  const metadata = {
    pageNumber: page.pageNumber,
    pageWidth: page.width,
    pageHeight: page.height,
    angle: page.angle,
    unit: page.unit || "",
    processed: true,
    timestamp: new Date().toISOString()
  }
  return {
    ...enriched,
    _metadata: enrichStringField(JSON.stringify(metadata), analysisResult, page)
  }
}

// Determine if a value is a plain object.
function isPlainObject(value: any): boolean {
    return Object.prototype.toString.call(value) === "[object Object]";
  }
  
  

  // Aggregates an array of enriched extraction objects into one comprehensive extraction.
export function aggregateExtractions(extractions: any[]): any {
    let aggregated = {};
    for (const extraction of extractions) {
      aggregated = deepMerge(aggregated, extraction);
    }
    return aggregated;
  }
  
  
  // Recursively deep merge two objects/arrays.
  function deepMerge(obj1: any, obj2: any): any {
    if (isPlainObject(obj1) && isPlainObject(obj2)) {
      const merged = { ...obj1 };
      for (const key in obj2) {
        if (obj2.hasOwnProperty(key)) {
          if (merged.hasOwnProperty(key)) {
            merged[key] = deepMerge(merged[key], obj2[key]);
          } else {
            merged[key] = obj2[key];
          }
        }
      }
      return merged;
    } else if (Array.isArray(obj1) && Array.isArray(obj2)) {
      const mergedArray = [...obj1];
      for (const item of obj2) {
        if (!mergedArray.some(existing => JSON.stringify(existing) === JSON.stringify(item))) {
          mergedArray.push(item);
        }
      }
      return mergedArray;
    } else {
      return obj1 === obj2 ? obj1 : [obj1, obj2];
    }
  }