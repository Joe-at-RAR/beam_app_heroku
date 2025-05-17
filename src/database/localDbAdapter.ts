// import fs from 'fs/promises';
// import path from 'path';
// import { DbAdapter } from './dbAdapterInterface';
// // Assuming Patient type is globally available or defined elsewhere for now
// // import { Patient } from '@shared/types'; // Keep commented out for now

// // Assuming DocumentFileSetItem and Alert types are defined elsewhere or using 'any'
// // interface DocumentFileSetItem { clientFileId: string; alerts?: Alert[] }
// // interface Alert { type: string; acknowledged: boolean }

// export class LocalDbAdapter implements DbAdapter {
//   private data: { patients: any[] } = { patients: [] };
//   private dataPath: string;
//   private isLoaded = false;

//   constructor(dataPath = './src/data/patients.json') {
//     // Ensure the path is absolute relative to the project root or module location
//     this.dataPath = path.resolve(__dirname, '..', dataPath);
//     // No initial load here, load lazily or explicitly via connect
//   }

//   private async loadData(): Promise<void> {
//     if (this.isLoaded) return;
//     try {
//       const fileContent = await fs.readFile(this.dataPath, 'utf-8');
//       this.data = JSON.parse(fileContent);
//       this.isLoaded = true;
//       console.log('[LocalDbAdapter] Data loaded successfully.');
//     } catch (error: any) {
//       if (error.code === 'ENOENT') {
//         console.log('[LocalDbAdapter] Data file not found, starting with empty data.');
//         this.data = { patients: [] };
//         // Optionally create the file/directory
//         await this.saveData(); 
//       } else {
//         console.error('[LocalDbAdapter] Error loading data:', error);
//         throw new Error('Failed to load local database.');
//       }
//     }
//   }

//   private async saveData(): Promise<void> {
//     try {
//       await fs.writeFile(this.dataPath, JSON.stringify(this.data, null, 2), 'utf-8');
//       console.log('[LocalDbAdapter] Data saved successfully.');
//     } catch (error) {
//       console.error('[LocalDbAdapter] Error saving data:', error);
//       throw new Error('Failed to save local database.');
//     }
//   }

//   async connect(): Promise<void> {
//     await this.loadData();
//   }

//   async disconnect(): Promise<void> {
//     // No explicit disconnection needed for file system
//     this.isLoaded = false; // Reset loaded state
//     console.log('[LocalDbAdapter] Disconnected (reset loaded state).');
//   }

//   // --- Patient Methods --- 
//   async getAllPatients(): Promise<any[]> { 
//     await this.loadData();
//     return this.data.patients;
//   }

//   async getPatientById(id: string): Promise<any | null> { 
//     await this.loadData();
//     return this.data.patients.find(p => p.silknotePatientUuid === id) || null;
//   }

//   async createPatient(patient: any): Promise<any> { 
//     await this.loadData();
//     // Basic validation/check for duplicates
//     if (this.data.patients.some(p => p.silknotePatientUuid === patient.silknotePatientUuid)) {
//         throw new Error(`Patient with ID ${patient.silknotePatientUuid} already exists.`);
//     }
//     this.data.patients.push(patient);
//     await this.saveData();
//     return patient;
//   }

//   async updatePatient(patient: any): Promise<any | null> {
//     await this.loadData();
//     const index = this.data.patients.findIndex(p => p.silknotePatientUuid === patient.silknotePatientUuid);
//     if (index === -1) {
//       return null; // Not found
//     }
//     this.data.patients[index] = patient;
//     await this.saveData();
//     return patient;
//   }

//   async deletePatient(id: string): Promise<boolean> {
//     await this.loadData();
//     const initialLength = this.data.patients.length;
//     this.data.patients = this.data.patients.filter(p => p.silknotePatientUuid !== id);
//     const deleted = this.data.patients.length < initialLength;
//     if (deleted) {
//       await this.saveData();
//     }
//     return deleted;
//   }
  
//   // --- Alert Methods --- 
//   async acknowledgeDocumentAlert(patientId: string, clientFileId: string, alertType: string): Promise<boolean> {
//     await this.loadData(); // Ensure latest data
//     const patientIndex = this.data.patients.findIndex(p => p.silknotePatientUuid === patientId);

//     if (patientIndex === -1) {
//       console.error(`[LocalDbAdapter] Patient not found: ${patientId}`);
//       return false;
//     }

//     const patient = this.data.patients[patientIndex];
    
//     // Assuming fileSet holds the documents and using safe navigation
//     const fileSet = patient?.fileSet;
//     if (!fileSet || !Array.isArray(fileSet)) {
//         console.error(`[LocalDbAdapter] Patient ${patientId} has no valid fileSet array.`);
//         return false;
//     }

//     let alertAcknowledged = false;
//     let documentFound = false;

//     // Iterate through fileSet to find the document and alert
//     for (const doc of fileSet) { // Using explicit type 'any' for now
//       // Assuming doc structure has clientFileId and alerts array
//       if (doc && doc.clientFileId === clientFileId) { 
//         documentFound = true;
//         const alerts = doc.alerts;
//         if (alerts && Array.isArray(alerts)) {
//           for (const alert of alerts) { // Using explicit type 'any'
//             if (alert && alert.type === alertType && !alert.acknowledged) {
//               alert.acknowledged = true;
//               alertAcknowledged = true;
//               console.log(`[LocalDbAdapter] Acknowledged alert '${alertType}' for doc ${clientFileId} in patient ${patientId}`);
//               // Optionally break if only one alert of this type needs acknowledgement
//               // break; 
//             }
//           }
//         }
//         // Break outer loop once document is found
//         break;
//       }
//     }

//     if (!documentFound) {
//         console.error(`[LocalDbAdapter] Document not found: ${clientFileId} for patient ${patientId}`);
//         return false;
//     }

//     if (!alertAcknowledged) {
//         console.warn(`[LocalDbAdapter] No unacknowledged alert of type '${alertType}' found for doc ${clientFileId} in patient ${patientId}, or alert already acknowledged.`);
//         // Still return true as the operation conceptually succeeded (no error occurred)
//         return true; 
//     }

//     // Save the updated data
//     await this.saveData();
//     return true;
//   }
// } 