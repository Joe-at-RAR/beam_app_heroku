import { MedicalDocument, PatientDetails } from '@shared/types';

export interface Patient {
  silknotePatientUuid: string;
  // ... other patient fields ...
  fileSet: MedicalDocument[];
}

// PatientDetails is now imported from shared/types.ts 