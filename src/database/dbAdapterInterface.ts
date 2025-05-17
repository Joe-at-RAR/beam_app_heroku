// import { Patient } from '@shared/types';

export interface DbAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;

  // Patient methods
  getAllPatients(): Promise<any[]>;
  getPatientById(id: string): Promise<any | null>;
  createPatient(patient: any): Promise<any>;
  updatePatient(patient: any): Promise<any | null>;
  deletePatient(id: string): Promise<boolean>;

  // Document methods (if any separate ones exist)
  // ...

  // Alert methods
  acknowledgeDocumentAlert(patientId: string, clientFileId: string, alertType: string): Promise<boolean>;

  // Vector Store methods
  // ... other methods
} 