import * as fs from 'fs/promises';
import * as path from 'path';
const libre = require('libreoffice-convert');
const pdf = require('html-pdf');
const XLSX = require('xlsx');
import { promisify } from 'util';

// Create a small test Excel file
async function createSmallTestFile() {
  const workbook = XLSX.utils.book_new();
  
  // Simple sheet with 10 rows
  const data = [
    ['Name', 'Age', 'Email'],
    ['John Doe', 30, 'john@example.com'],
    ['Jane Smith', 25, 'jane@example.com'],
    ['Bob Johnson', 35, 'bob@example.com'],
    ['Alice Brown', 28, 'alice@example.com'],
    ['Charlie Davis', 40, 'charlie@example.com'],
    ['Eva Wilson', 32, 'eva@example.com'],
    ['Frank Miller', 45, 'frank@example.com'],
    ['Grace Lee', 27, 'grace@example.com'],
    ['Henry Taylor', 38, 'henry@example.com']
  ];
  
  const sheet = XLSX.utils.aoa_to_sheet(data);
  XLSX.utils.book_append_sheet(workbook, sheet, 'Test Data');
  
  const filePath = path.join(__dirname, 'small-test.xlsx');
  XLSX.writeFile(workbook, filePath);
  console.log('Created small test file:', filePath);
  return filePath;
}

// Simple HTML conversion
async function simpleConvertToPDF(xlsxPath: string) {
  const fileBuffer = await fs.readFile(xlsxPath);
  const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
  
  // Convert to simple HTML
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    table { border-collapse: collapse; }
    td, th { border: 1px solid black; padding: 5px; }
  </style>
</head>
<body>
  <h1>Test Excel Conversion</h1>
  ${XLSX.utils.sheet_to_html(sheet)}
</body>
</html>`;

  // Save HTML for debugging
  const htmlPath = path.join(__dirname, 'test-output.html');
  await fs.writeFile(htmlPath, html);
  console.log('Saved HTML to:', htmlPath);
  
  // Convert to PDF
  return new Promise<void>((resolve, reject) => {
    pdf.create(html, {
      format: 'A4',
      border: { top: "10mm", right: "10mm", bottom: "10mm", left: "10mm" }
    }).toFile(path.join(__dirname, 'small-test-output.pdf'), (err: any, res: any) => {
      if (err) {
        console.error('PDF creation failed:', err);
        reject(err);
      } else {
        console.log('PDF created:', res.filename);
        resolve();
      }
    });
  });
}

// Run test
async function runSimpleTest() {
  try {
    console.log('Creating small test file...');
    const xlsxPath = await createSmallTestFile();
    
    console.log('Converting to PDF...');
    await simpleConvertToPDF(xlsxPath);
    
    console.log('Test completed successfully!');
  } catch (error) {
    console.error('Test failed:', error);
  }
}

runSimpleTest(); 