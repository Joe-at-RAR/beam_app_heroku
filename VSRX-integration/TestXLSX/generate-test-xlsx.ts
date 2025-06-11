import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';

// Generate a test Excel file with multiple sheets and lots of data
function generateTestExcel() {
  console.log('Generating test Excel file...');
  
  const workbook = XLSX.utils.book_new();
  
  // Sheet 1: Patient Data (150 rows x 15 columns)
  console.log('Creating Sheet 1: Patient Data');
  const patientData: any[][] = [
    ['Patient ID', 'First Name', 'Last Name', 'DOB', 'Gender', 'Phone', 'Email', 'Address', 'City', 'State', 'ZIP', 'Insurance', 'Policy #', 'Group #', 'Notes']
  ];
  
  for (let i = 1; i <= 150; i++) {
    patientData.push([
      `P${String(i).padStart(5, '0')}`,
      `FirstName${i}`,
      `LastName${i}`,
      `${Math.floor(Math.random() * 12) + 1}/${Math.floor(Math.random() * 28) + 1}/${1950 + Math.floor(Math.random() * 70)}`,
      i % 2 === 0 ? 'M' : 'F',
      `(555) ${String(Math.floor(Math.random() * 900) + 100)}-${String(Math.floor(Math.random() * 9000) + 1000)}`,
      `patient${i}@example.com`,
      `${Math.floor(Math.random() * 9999) + 1} Main St`,
      'Anytown',
      'ST',
      String(10000 + Math.floor(Math.random() * 89999)),
      `Insurance${Math.floor(Math.random() * 5) + 1}`,
      `POL${String(Math.floor(Math.random() * 999999)).padStart(6, '0')}`,
      `GRP${String(Math.floor(Math.random() * 9999)).padStart(4, '0')}`,
      `Patient notes for record ${i}. This is some additional information that might be relevant for medical history.`
    ]);
  }
  
  const patientSheet = XLSX.utils.aoa_to_sheet(patientData);
  XLSX.utils.book_append_sheet(workbook, patientSheet, 'Patient Data');
  
  // Sheet 2: Lab Results (200 rows x 20 columns)
  console.log('Creating Sheet 2: Lab Results');
  const labHeaders = ['Lab ID', 'Patient ID', 'Date', 'Time', 'Test Type', 'Result', 'Unit', 'Reference Range', 'Flag', 'Ordered By', 
                      'Lab Tech', 'Status', 'Priority', 'Comments', 'Method', 'Equipment', 'QC Status', 'Verified By', 'Verified Date', 'Notes'];
  const labData: any[][] = [labHeaders];
  
  const testTypes = ['CBC', 'BMP', 'Lipid Panel', 'HbA1c', 'TSH', 'Glucose', 'Creatinine', 'ALT', 'AST'];
  const flags = ['', 'H', 'L', 'HH', 'LL'];
  
  for (let i = 1; i <= 200; i++) {
    labData.push([
      `LAB${String(i).padStart(6, '0')}`,
      `P${String(Math.floor(Math.random() * 150) + 1).padStart(5, '0')}`,
      `${Math.floor(Math.random() * 12) + 1}/${Math.floor(Math.random() * 28) + 1}/2024`,
      `${String(Math.floor(Math.random() * 24)).padStart(2, '0')}:${String(Math.floor(Math.random() * 60)).padStart(2, '0')}`,
      testTypes[Math.floor(Math.random() * testTypes.length)],
      (Math.random() * 200).toFixed(2),
      'mg/dL',
      '70-100',
      flags[Math.floor(Math.random() * flags.length)],
      `Dr. Smith${Math.floor(Math.random() * 10)}`,
      `Tech${Math.floor(Math.random() * 20) + 1}`,
      'Completed',
      i % 10 === 0 ? 'STAT' : 'Routine',
      `Lab comments for test ${i}`,
      'Standard Method',
      `Analyzer${Math.floor(Math.random() * 5) + 1}`,
      'Pass',
      `Verifier${Math.floor(Math.random() * 5) + 1}`,
      `${Math.floor(Math.random() * 12) + 1}/${Math.floor(Math.random() * 28) + 1}/2024`,
      `Additional notes for lab result ${i}`
    ]);
  }
  
  const labSheet = XLSX.utils.aoa_to_sheet(labData);
  XLSX.utils.book_append_sheet(workbook, labSheet, 'Lab Results');
  
  // Sheet 3: Medications (100 rows x 12 columns)
  console.log('Creating Sheet 3: Medications');
  const medHeaders = ['Rx ID', 'Patient ID', 'Medication', 'Dosage', 'Frequency', 'Route', 'Start Date', 'End Date', 'Prescriber', 'Pharmacy', 'Refills', 'Notes'];
  const medData: any[][] = [medHeaders];
  
  const medications = ['Lisinopril', 'Metformin', 'Atorvastatin', 'Levothyroxine', 'Omeprazole', 'Amlodipine', 'Metoprolol', 'Losartan'];
  const routes = ['PO', 'IV', 'IM', 'SC', 'Topical'];
  
  for (let i = 1; i <= 100; i++) {
    medData.push([
      `RX${String(i).padStart(6, '0')}`,
      `P${String(Math.floor(Math.random() * 150) + 1).padStart(5, '0')}`,
      medications[Math.floor(Math.random() * medications.length)],
      `${Math.floor(Math.random() * 100) + 10}mg`,
      ['QD', 'BID', 'TID', 'QID', 'PRN'][Math.floor(Math.random() * 5)],
      routes[Math.floor(Math.random() * routes.length)],
      `${Math.floor(Math.random() * 12) + 1}/1/2024`,
      `${Math.floor(Math.random() * 12) + 1}/1/2025`,
      `Dr. Johnson${Math.floor(Math.random() * 5) + 1}`,
      `Pharmacy${Math.floor(Math.random() * 3) + 1}`,
      Math.floor(Math.random() * 12),
      `Medication notes for prescription ${i}`
    ]);
  }
  
  const medSheet = XLSX.utils.aoa_to_sheet(medData);
  XLSX.utils.book_append_sheet(workbook, medSheet, 'Medications');
  
  // Sheet 4: Wide Financial Data (50 rows x 30 columns)
  console.log('Creating Sheet 4: Financial Summary');
  const finHeaders = ['Account ID', 'Patient ID', 'Service Date', 'Service Code', 'Description', 'Provider', 'Facility',
                      'Billed Amount', 'Insurance Adj', 'Insurance Paid', 'Patient Resp', 'Patient Paid', 'Balance',
                      'Status', 'Auth #', 'Claim #', 'EOB Date', 'Check #', 'Payment Date', 'Collection Status',
                      'Col1', 'Col2', 'Col3', 'Col4', 'Col5', 'Col6', 'Col7', 'Col8', 'Col9', 'Notes'];
  const finData: any[][] = [finHeaders];
  
  for (let i = 1; i <= 50; i++) {
    const billed = Math.floor(Math.random() * 5000) + 100;
    const adj = Math.floor(billed * 0.3);
    const paid = Math.floor((billed - adj) * 0.8);
    const resp = billed - adj - paid;
    
    finData.push([
      `ACC${String(i).padStart(6, '0')}`,
      `P${String(Math.floor(Math.random() * 150) + 1).padStart(5, '0')}`,
      `${Math.floor(Math.random() * 12) + 1}/${Math.floor(Math.random() * 28) + 1}/2024`,
      `CPT${String(Math.floor(Math.random() * 99999)).padStart(5, '0')}`,
      `Medical Service Description ${i}`,
      `Dr. Provider${Math.floor(Math.random() * 10) + 1}`,
      `Facility${Math.floor(Math.random() * 5) + 1}`,
      `$${billed.toFixed(2)}`,
      `$${adj.toFixed(2)}`,
      `$${paid.toFixed(2)}`,
      `$${resp.toFixed(2)}`,
      `$${(resp * 0.5).toFixed(2)}`,
      `$${(resp * 0.5).toFixed(2)}`,
      ['Pending', 'Paid', 'Partial', 'Denied'][Math.floor(Math.random() * 4)],
      `AUTH${String(Math.floor(Math.random() * 999999)).padStart(6, '0')}`,
      `CLM${String(Math.floor(Math.random() * 999999)).padStart(6, '0')}`,
      `${Math.floor(Math.random() * 12) + 1}/${Math.floor(Math.random() * 28) + 1}/2024`,
      `CHK${String(Math.floor(Math.random() * 9999)).padStart(4, '0')}`,
      `${Math.floor(Math.random() * 12) + 1}/${Math.floor(Math.random() * 28) + 1}/2024`,
      'Active',
      `Data${i}-1`, `Data${i}-2`, `Data${i}-3`, `Data${i}-4`, `Data${i}-5`,
      `Data${i}-6`, `Data${i}-7`, `Data${i}-8`, `Data${i}-9`,
      `Financial notes for account ${i}`
    ]);
  }
  
  const finSheet = XLSX.utils.aoa_to_sheet(finData);
  XLSX.utils.book_append_sheet(workbook, finSheet, 'Financial Summary');
  
  // Sheet 5: Summary Statistics
  console.log('Creating Sheet 5: Summary Statistics');
  const summaryData = [
    ['Summary Report', '', '', ''],
    ['Generated Date:', new Date().toLocaleDateString(), '', ''],
    ['', '', '', ''],
    ['Sheet Name', 'Total Rows', 'Total Columns', 'Description'],
    ['Patient Data', 150, 15, 'Patient demographics and contact information'],
    ['Lab Results', 200, 20, 'Laboratory test results and findings'],
    ['Medications', 100, 12, 'Current and past medications'],
    ['Financial Summary', 50, 30, 'Billing and payment information'],
    ['', '', '', ''],
    ['Total Records:', 500, '', ''],
    ['', '', '', ''],
    ['Notes:', 'This is a test file with sample data for VSRX sync testing', '', ''],
    ['Purpose:', 'Validate Excel to PDF conversion with multiple sheets and large datasets', '', '']
  ];
  
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');
  
  // Write the file
  const outputPath = path.join(__dirname, 'test-data.xlsx');
  XLSX.writeFile(workbook, outputPath);
  
  console.log(`Test Excel file created: ${outputPath}`);
  console.log('File contains:');
  console.log('- 5 sheets');
  console.log('- 500+ total rows of data');
  console.log('- Wide tables (up to 30 columns)');
  console.log('- Various data types and formats');
  
  // Get file size
  const stats = fs.statSync(outputPath);
  console.log(`File size: ${(stats.size / 1024).toFixed(2)} KB`);
}

// Run the generator
generateTestExcel(); 