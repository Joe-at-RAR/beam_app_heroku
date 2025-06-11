import * as fs from 'fs/promises';
import * as path from 'path';
const libre = require('libreoffice-convert');
const pdf = require('html-pdf');
const XLSX = require('xlsx');
import { promisify } from 'util';

const libreConvert = promisify(libre.convert);

// Test conversion function (copied from vsrx-sync.ts)
async function convertXLSXToPDF(fileBuffer: Buffer): Promise<Buffer> {
  try {
    console.log('Attempting LibreOffice conversion...');
    const pdfBuffer = await libreConvert(fileBuffer, 'pdf', 'calc_pdf_Export');
    console.log('LibreOffice conversion successful');
    return pdfBuffer;
  } catch (error) {
    console.log('LibreOffice conversion failed, using custom HTML approach:', error);
    
    // Fallback to custom HTML conversion
    const htmlContent = await createExcelHTML(fileBuffer);
    console.log(`Generated HTML size: ${(Buffer.byteLength(htmlContent) / 1024).toFixed(2)} KB`);
    const pdfBuffer = await htmlToPDF(htmlContent);
    console.log('Custom HTML conversion successful');
    return pdfBuffer;
  }
}

async function createExcelHTML(fileBuffer: Buffer): Promise<string> {
  const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
  
  let html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; margin: 10px; font-size: 10px; }
    table { border-collapse: collapse; width: 100%; margin-bottom: 20px; page-break-inside: auto; }
    tr { page-break-inside: avoid; page-break-after: auto; }
    th, td { border: 1px solid #ccc; padding: 4px; text-align: left; font-size: 9px; max-width: 200px; overflow: hidden; text-overflow: ellipsis; }
    th { background-color: #f0f0f0; font-weight: bold; position: sticky; top: 0; }
    .sheet-title { font-size: 14px; font-weight: bold; margin: 15px 0 10px 0; page-break-before: always; }
    .sheet-title:first-child { page-break-before: avoid; }
    .page-break { page-break-after: always; }
    .info { background: #e8f4f8; padding: 10px; margin: 10px 0; border-radius: 5px; }
    @media print {
      .sheet-title { page-break-before: always; }
      .sheet-title:first-child { page-break-before: avoid; }
    }
  </style>
</head>
<body>
`;

  const sheetNames = workbook.SheetNames;
  
  // Add summary
  html += '<h1>Excel Workbook Contents</h1>';
  html += '<div class="info">';
  html += `<p><strong>Total Sheets:</strong> ${sheetNames.length}</p>`;
  html += '<ul>';
  
  sheetNames.forEach(name => {
    const sheet = workbook.Sheets[name];
    const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
    const rows = range.e.r - range.s.r + 1;
    const cols = range.e.c - range.s.c + 1;
    html += `<li><strong>${name}:</strong> ${rows} rows × ${cols} columns</li>`;
  });
  
  html += '</ul></div>';
  html += '<div class="page-break"></div>';
  
  // Process each sheet
  sheetNames.forEach((sheetName, index) => {
    const sheet = workbook.Sheets[sheetName];
    const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
    const rows = range.e.r - range.s.r + 1;
    const cols = range.e.c - range.s.c + 1;
    
    html += `<div class="sheet-title">Sheet ${index + 1}: ${sheetName}</div>`;
    html += `<div class="info">Dimensions: ${rows} rows × ${cols} columns</div>`;
    
    // Convert sheet to HTML table
    const htmlTable = XLSX.utils.sheet_to_html(sheet, {
      header: '',
      footer: ''
    });
    
    // Extract just the table part
    const tableMatch = htmlTable.match(/<table[^>]*>([\s\S]*?)<\/table>/);
    if (tableMatch) {
      html += tableMatch[0];
    }
  });
  
  html += '</body></html>';
  return html;
}

async function htmlToPDF(html: string): Promise<Buffer> {
  // Save HTML to temp file first to avoid EPIPE errors
  const tempHtmlPath = path.join(__dirname, 'temp-convert.html');
  await fs.writeFile(tempHtmlPath, html);
  
  const pdfBuffer = await new Promise<Buffer>((resolve, reject) => {
    // Read from file instead of passing string to avoid EPIPE
    const htmlContent = require('fs').readFileSync(tempHtmlPath, 'utf8');
    pdf.create(htmlContent, {
      format: 'A3',  // Larger format for wide tables
      orientation: 'landscape',
      border: {
        top: "10mm",
        right: "10mm",
        bottom: "10mm",
        left: "10mm"
      },
      header: {
        height: "15mm",
        contents: '<div style="text-align: center; font-size: 9px; color: #666;">Excel Document - Page {{page}} of {{pages}}</div>'
      },
      footer: {
        height: "10mm",
        contents: '<div style="text-align: center; font-size: 8px; color: #666;">Generated on ' + new Date().toLocaleDateString() + ' at ' + new Date().toLocaleTimeString() + '</div>'
      },
      timeout: 300000,  // 5 minute timeout for large files
      childProcessOptions: {
        maxBuffer: 1024 * 1024 * 50  // 50MB buffer
      }
    }).toBuffer((err: any, buffer: Buffer) => {
      if (err) {
        console.error('PDF creation error:', err);
        reject(err);
      } else {
        resolve(buffer);
      }
    });
  });
  
  // Clean up temp file
  try {
    await fs.unlink(tempHtmlPath);
  } catch {}
  
  return pdfBuffer;
}

// Main test function
async function runTest() {
  console.log('Starting XLSX to PDF conversion test...\n');
  
  const inputPath = path.join(__dirname, 'test-data.xlsx');
  const outputPath = path.join(__dirname, 'test-output.pdf');
  
  try {
    // Check if input file exists
    try {
      await fs.access(inputPath);
    } catch {
      console.error('Input file not found. Please run generate-test-xlsx.ts first.');
      return;
    }
    
    // Read the Excel file
    console.log(`Reading Excel file: ${inputPath}`);
    const fileBuffer = await fs.readFile(inputPath);
    const fileStats = await fs.stat(inputPath);
    console.log(`File size: ${(fileStats.size / 1024).toFixed(2)} KB`);
    
    // Convert to PDF
    console.log('\nConverting to PDF...');
    const startTime = Date.now();
    const pdfBuffer = await convertXLSXToPDF(fileBuffer);
    const conversionTime = Date.now() - startTime;
    
    // Save PDF
    await fs.writeFile(outputPath, pdfBuffer);
    const pdfStats = await fs.stat(outputPath);
    
    console.log(`\nConversion completed in ${conversionTime}ms`);
    console.log(`Output PDF size: ${(pdfStats.size / 1024).toFixed(2)} KB`);
    console.log(`Output saved to: ${outputPath}`);
    
    // Analyze the Excel file to verify content
    console.log('\nAnalyzing original Excel content:');
    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    let totalRows = 0;
    let totalCells = 0;
    
    workbook.SheetNames.forEach(sheetName => {
      const sheet = workbook.Sheets[sheetName];
      const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
      const rows = range.e.r - range.s.r + 1;
      const cols = range.e.c - range.s.c + 1;
      totalRows += rows;
      totalCells += rows * cols;
      console.log(`  ${sheetName}: ${rows} rows × ${cols} columns = ${rows * cols} cells`);
    });
    
    console.log(`\nTotal data points: ${totalCells} cells across ${totalRows} rows`);
    console.log('\nNOTE: The PDF should contain all ${totalRows} rows of data across all sheets.');
    console.log('Please manually verify the PDF contains all data by opening:', outputPath);
    
  } catch (error) {
    console.error('Conversion failed:', error);
  }
}

// Run the test
runTest(); 