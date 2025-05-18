import { MedicalDocument /*, PatientDetails*/ } from '@shared/types'; // Commented out PatientDetails

export interface Patient {
  silknotePatientUuid: string;
  // ... other patient fields ...
  fileSet: MedicalDocument[];
}

// PatientDetails is now imported from shared/types.ts 