# XLSX File Handling Strategy for VSRX Sync

## Overview

Excel files (.xlsx) present unique challenges for PDF conversion due to their potential size, multiple sheets, and complex layouts. This document outlines the recommended approach for handling these files in the VSRX sync process.

## Key Challenges

1. **Large Data Sets**: Excel files can contain thousands of rows and hundreds of columns
2. **Multiple Worksheets**: A single file may have many sheets with different structures
3. **Wide Tables**: Tables often exceed standard page width
4. **Complex Formatting**: Merged cells, formulas, charts, and conditional formatting
5. **Memory Constraints**: Large files can exhaust server memory during processing

## Recommended Approach

### Option 1: LibreOffice Conversion (Recommended for MVP)

**Pros:**
- Already integrated in the system
- Handles complex Excel features well
- Preserves most formatting
- Automatic page breaking

**Cons:**
- Less control over output
- May be slow for very large files
- Limited customization options

**Implementation:**
```typescript
// Add to existing convertToPDF method
if (ext === '.xlsx') {
  try {
    // Use LibreOffice with specific Excel options
    const pdfBuffer = await libreConvert(fileBuffer, 'pdf', 'calc_pdf_Export');
    return pdfBuffer;
  } catch (error) {
    throw new Error(`Excel conversion failed: ${error.message}`);
  }
}
```

### Option 2: Custom Excel Processing (Recommended for Production)

**Pros:**
- Full control over output
- Can implement smart pagination
- Memory-efficient streaming
- Custom handling for large datasets

**Cons:**
- More complex implementation
- Requires additional dependencies

**Implementation Strategy:**

```typescript
import * as ExcelJS from 'exceljs';

private async convertExcelToPDF(fileBuffer: Buffer): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(fileBuffer);
  
  // Build HTML with table of contents
  let html = this.buildExcelHTML(workbook);
  
  // Convert to PDF with landscape orientation for wide tables
  return await this.htmlToPDF(html, { 
    orientation: 'landscape',
    format: 'A3' 
  });
}

private buildExcelHTML(workbook: ExcelJS.Workbook): string {
  let html = `
    <html>
    <head>
      <style>
        table { border-collapse: collapse; width: 100%; margin: 20px 0; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; font-weight: bold; }
        .sheet-title { font-size: 18px; font-weight: bold; margin: 20px 0; }
        .toc { page-break-after: always; }
        .summary { background: #f9f9f9; padding: 10px; margin: 10px 0; }
      </style>
    </head>
    <body>
  `;
  
  // Add table of contents if multiple sheets
  if (workbook.worksheets.length > 1) {
    html += '<div class="toc"><h1>Excel File Contents</h1><ul>';
    workbook.eachSheet((worksheet, sheetId) => {
      const rowCount = worksheet.rowCount;
      const colCount = worksheet.columnCount;
      html += `<li>${worksheet.name} (${rowCount} rows × ${colCount} columns)</li>`;
    });
    html += '</ul></div>';
  }
  
  // Process each worksheet
  workbook.eachSheet((worksheet, sheetId) => {
    html += `<div class="sheet"><h2 class="sheet-title">${worksheet.name}</h2>`;
    
    // Add summary for large sheets
    if (worksheet.rowCount > 1000) {
      html += `
        <div class="summary">
          ⚠️ Large dataset: ${worksheet.rowCount} rows × ${worksheet.columnCount} columns
          <br>Showing first 1000 rows. Full data available in original Excel file.
        </div>
      `;
    }
    
    html += this.worksheetToHTML(worksheet);
    html += '</div>';
  });
  
  html += '</body></html>';
  return html;
}
```

## Recommended Configuration

### For Different File Sizes:

1. **Small Files (<1MB, <1000 rows)**
   - Full conversion with all formatting
   - Include all sheets

2. **Medium Files (1-10MB, 1000-10000 rows)**
   - Convert first 1000 rows per sheet
   - Add summary statistics
   - Include sheet overview

3. **Large Files (>10MB, >10000 rows)**
   - Convert first 500 rows as preview
   - Generate summary report
   - Include data statistics
   - Recommend user to view in Excel for full data

### PDF Layout Options:

```typescript
const pdfOptions = {
  // For normal tables
  portrait: {
    format: 'A4',
    orientation: 'portrait',
    border: { top: "10mm", right: "10mm", bottom: "10mm", left: "10mm" }
  },
  
  // For wide tables
  landscape: {
    format: 'A3',
    orientation: 'landscape',
    border: { top: "10mm", right: "10mm", bottom: "10mm", left: "10mm" }
  },
  
  // Auto-detect based on column count
  auto: (columnCount: number) => {
    return columnCount > 10 ? pdfOptions.landscape : pdfOptions.portrait;
  }
};
```

## Implementation Recommendations

### Phase 1 (Immediate)
- Use LibreOffice conversion (already available)
- Add .xlsx to supported formats
- Set reasonable timeout for large files
- Log conversion metrics

### Phase 2 (Near-term)
- Implement basic Excel parsing
- Add row limits for large files
- Create summary views
- Optimize for common use cases

### Phase 3 (Long-term)
- Streaming processing for huge files
- Smart table splitting
- Chart and image extraction
- Formula evaluation display

## Error Handling

```typescript
// Specific Excel error handling
try {
  pdfBuffer = await this.convertExcelToPDF(fileBuffer);
} catch (error) {
  if (error.message.includes('memory')) {
    // File too large, create summary instead
    pdfBuffer = await this.createExcelSummaryPDF(fileBuffer);
  } else {
    throw error;
  }
}
```

## Best Practices

1. **Set Limits**
   - Max file size: 50MB
   - Max rows to convert: 5000
   - Max processing time: 60 seconds

2. **Provide Feedback**
   - Include conversion notes in PDF
   - Show data truncation warnings
   - Add original file metrics

3. **Preserve Access**
   - Store original .xlsx in blob storage
   - Allow users to download original
   - Provide Excel viewer link

## Summary

For VSRX sync, we recommend starting with LibreOffice conversion (Option 1) as it's already integrated and handles most cases well. As usage patterns emerge, implement custom processing (Option 2) for better control over large files and complex spreadsheets.

The key is to balance completeness with practicality - users need to see their data, but converting a 50,000-row spreadsheet to PDF may not be the best approach. Instead, provide intelligent previews with access to the original file. 