import { z } from 'zod'
// Copied parseCaseSummary function from extraction-schema.ts
function parseCaseSummary(rawSummary: any): CaseSummaryType | null {
  const result = CaseSummaryZodSchema.safeParse(rawSummary)
  if (!result.success) {
    console.log('Case summary parsing error:', result.error)
    return null
  }
  return result.data
}


// Copied CaseSummaryZodSchema from extraction-schema.ts
const CaseSummaryZodSchema = z.object({
  narrativeOverview: z.string().nullable().describe("Comprehensive medical journey narrative"),
  reportTitle: z.string().nullable().describe("Report title"),
  patientName: z.string().nullable().describe("Patient's full name"),
  reportDate: z.string().nullable().describe("Report generation date"),
  patientDateOfBirth: z.string().nullable().describe("Patient's DOB"),
  patientGender: z.string().nullable().describe("Patient's gender"),
  patientOccupation: z.string().nullable().describe("Patient's occupation"),
  insurerName: z.string().nullable().describe("Insurance provider name"),
  insuranceScheme: z.string().nullable().describe("Insurance scheme (WorkCover, MVA, etc.)"),
  claimNumber: z.string().nullable().describe("Insurance claim number"),
  policyType: z.string().nullable().describe("Type of insurance policy"),
  socialHistory: z.string().nullable().describe("Social and lifestyle factors"),
  diagnoses: z.array(z.object({
    id: z.string().describe("Unique identifier for this diagnosis entry"),
    condition: z.string().nullable().describe("Diagnosis"),
    status: z.string().describe("Current status of the diagnosis"),
    diagnosisDate: z.string().nullable().describe("Date diagnosed"),
    notes: z.string().nullable().describe("Additional notes")
  })).nullable().describe("Diagnoses list"),
  keyEvents: z.array(z.object({
    id: z.string().describe("Unique identifier for this key event entry"),
    eventType: z.string().nullable().describe("Event type"),
    eventDate: z.string().nullable().describe("Event date"),
    eventTitle: z.string().nullable().describe("Event title"),
    eventDescription: z.string().nullable().describe("Event description"),
    providers: z.array(z.object({
      name: z.string().nullable().describe("Provider name"),
      role: z.string().nullable().describe("Provider role"),
      organization: z.string().nullable().describe("Provider organization")
    })).nullable().describe("Healthcare providers"),
    workCapacity: z.object({
      status: z.string().nullable().describe("Work capacity status"),
      hours: z.string().nullable().describe("Working hours"),
      restrictions: z.array(z.string()).nullable().describe("Restrictions")
    }).nullable().describe("Work capacity"),
    documents: z.array(z.object({
      id: z.string().nullable().describe("Document ID"),
      title: z.string().nullable().describe("Document title"),
      type: z.string().nullable().describe("Document type")
    })).nullable().describe("Related documents"),
    significance: z.string().nullable().describe("Event significance"),
    notes: z.string().nullable().describe("Additional notes")
  })).nullable().describe("Key case events"),
  treatments: z.array(z.object({
    id: z.string().describe("Unique identifier for this treatment entry"),
    treatment: z.string().nullable().describe("Treatment description"),
    date: z.string().nullable().describe("Treatment date"),
    provider: z.string().nullable().describe("Provider"),
    type: z.string().describe("The category of treatment"),
    notes: z.string().nullable().describe("Notes")
  })).nullable().describe("Treatments"),
  testResults: z.array(z.object({
    id: z.string().describe("Unique identifier for this test result entry"),
    testName: z.string().nullable().describe("Test name"),
    date: z.string().nullable().describe("Test date"),
    result: z.string().nullable().describe("Result"),
    range: z.string().nullable().describe("Normal range")
  })).nullable().describe("Test results"),
  employerName: z.string().nullable().describe("Employer name"),
  employmentStatus: z.string().nullable().describe("Employment status"),
  workRelatedInjury: z.boolean().nullable().describe("Work-related injury"),
  employmentNotes: z.string().nullable().describe("Employment notes"),
  legalNotes: z.string().nullable().describe("Legal case notes"),
  medicalInconsistencies: z.object({
    hasInconsistencies: z.boolean().default(false).describe("Whether any inconsistencies were detected"),
    inconsistencies: z.array(z.object({
      type: z.string().describe("Type of inconsistency (e.g., 'Diagnosis', 'Medication', 'Treatment')"),
      severity: z.string().nullable().describe("Severity level (e.g., 'High', 'Medium', 'Low')"),
      description: z.string().describe("Description of the inconsistency"),
      relatedDocuments: z.array(z.object({
        id: z.string().nullable().describe("Document ID"),
        citationToVectorStoreFile: z.string().nullable().describe("Document title"),
        contradictingValues: z.array(z.string()).nullable().describe("Specific contradicting values in this document")
      })).nullable().describe("Documents related to this inconsistency")
    })).nullable().describe("List of detected inconsistencies")
  }).describe("Medical inconsistencies detected in the documents")
}).describe("Flattened medical case summary schema")

// Copied CaseSummaryType from extraction-schema.ts
 type CaseSummaryType = z.infer<typeof CaseSummaryZodSchema>



// Copied ViewerCaseSummarySchema interface from extraction-schema.ts
interface ViewerCaseSummarySchema {
  narrativeOverview: string
  coverPage: { title: string; patientName: string; reportDate: string }
  patientOverview: {
    personalInformation: { fullName: string; dateOfBirth: string; gender: string; occupation: string }
    insuranceDetails: {
      insurer: string
      scheme: string
      claimNumber?: string
      policyType?: string
    }
    socialHistory?: string
  }
,
 diagnoses: Array<{ condition: string; status: string; diagnosisDate: string, notes?: string }>
  keyEvents?: Array<{ eventType: string; eventDate: string; eventTitle: string; eventDescription: string; relatedProviders?: Array<{ providerName: string; providerRole: string; organization?: string }>; workCapacityDetails?: { status?: string; hours?: string; restrictions?: string[]; reviewer?: string }; citationToVectorStoreFile?: Array<{ id: string; title: string; type: string; sourcePage?: number }>; significance?: string; additionalNotes?: string }>
  clinicalSummary: { diagnoses: Array<{ diagnosis: string; diagnosisDate?: string; status: string }>; treatments: Array<{ treatment: string; treatmentDate?: string; provider?: string; type?: string; notes?: string }>; testResults?: Array<{ testName: string; date?: string; result: string; referenceRange?: string }> }
  insurance?: { insurerName: string; policyNumber?: string; claimID?: string; scheme?: string; notes?: string }
  medicolegalSummary?: { employerDocumentation?: { employerName?: string; employmentStatus?: string; workRelatedInjury?: boolean; notes?: string }; legalNotes?: string }
  medicalInconsistencies?: { hasInconsistencies: boolean; inconsistencies?: Array<{ type: string; severity: string | null; description: string; relatedDocuments?: Array<{ id: string; citationToVectorStoreFile: string; contradictingValues?: string[] }> }> }
}

// Copied adaptForCaseSummaryViewer function from extraction-schema.ts
function adaptForCaseSummaryViewer(flattenedSummary: CaseSummaryType): ViewerCaseSummarySchema {
  return {
    narrativeOverview: flattenedSummary.narrativeOverview || '',
    coverPage: {
      title: flattenedSummary.reportTitle || '',
      patientName: flattenedSummary.patientName || '',
      reportDate: flattenedSummary.reportDate || ''
    },
    patientOverview: {
      personalInformation: {
        fullName: flattenedSummary.patientName || '',
        dateOfBirth: flattenedSummary.patientDateOfBirth || '',
        gender: flattenedSummary.patientGender || '',
        occupation: flattenedSummary.patientOccupation || ''
      },
      insuranceDetails: {
        insurer: flattenedSummary.insurerName || '',
        scheme: flattenedSummary.insuranceScheme || '',
        claimNumber: flattenedSummary.claimNumber || undefined,
        policyType: flattenedSummary.policyType || undefined
      },
      socialHistory: flattenedSummary.socialHistory || undefined,

    },

    diagnoses: (flattenedSummary.diagnoses || []).map(d => ({
      condition: d.condition || '',
      status: d.status || '',
      diagnosisDate: d.diagnosisDate || '',
      notes: d.notes || ''
    })),
    keyEvents: (flattenedSummary.keyEvents || []).map(event => ({
      eventType: event.eventType || '',
      eventDate: event.eventDate || '',
      eventTitle: event.eventTitle || '',
      eventDescription: event.eventDescription || '',
      relatedProviders: event.providers?.map(p => ({
        providerName: p.name || '',
        providerRole: p.role || '',
        organization: p.organization || ''
      })) || [],
      workCapacityDetails: event.workCapacity ? {
        status: event.workCapacity.status || '',
        hours: event.workCapacity.hours || '',
        restrictions: event.workCapacity.restrictions || [],
        reviewer: ''
      } : undefined,
      citationToVectorStoreFile: event.documents?.map(doc => ({
        id: doc.id || '',
        title: doc.title || '',
        type: doc.type || '',
        sourcePage: undefined // Optional
      })) || [],
      significance: event.significance || '',
      additionalNotes: event.notes || ''
    })),
    clinicalSummary: {
      diagnoses: flattenedSummary.diagnoses?.map(d => ({
        diagnosis: d.condition || '',
        diagnosisDate: d.diagnosisDate || '',
        status: d.status || '',
      })) || [],
      treatments: (flattenedSummary.treatments || []).map(t => ({
        treatment: t.treatment || '',
        treatmentDate: t.date || '',
        provider: t.provider || '',
        type: t.type || 'Other',
        notes: t.notes || ''
      })),
      testResults: (flattenedSummary.testResults || []).map(t => ({
        testName: t.testName || '',
        date: t.date || '',
        result: t.result || '',
        referenceRange: t.range || ''
      }))
    },
    insurance: {
      insurerName: flattenedSummary.insurerName || '',
      policyNumber: flattenedSummary.policyType || '',
      claimID: flattenedSummary.claimNumber || '',
      scheme: flattenedSummary.insuranceScheme || '',
      notes: ''
    },
    medicolegalSummary: {
      employerDocumentation: {
        employerName: flattenedSummary.employerName || '',
        employmentStatus: flattenedSummary.employmentStatus || '',
        workRelatedInjury: flattenedSummary.workRelatedInjury ?? false,
        notes: flattenedSummary.employmentNotes || ''
      },
      legalNotes: flattenedSummary.legalNotes || ''
    },
    medicalInconsistencies: flattenedSummary.medicalInconsistencies
      ? {
          hasInconsistencies: flattenedSummary.medicalInconsistencies.hasInconsistencies || false,
          inconsistencies: flattenedSummary.medicalInconsistencies.inconsistencies?.map(inc => ({
            type: inc.type || 'Unknown',
            severity: inc.severity,
            description: inc.description || '',
            relatedDocuments: inc.relatedDocuments?.map(doc => ({
              id: doc.id || '',
              citationToVectorStoreFile: doc.citationToVectorStoreFile || doc.id || '',
              contradictingValues: doc.contradictingValues || []
            })) || []
          })) || []
        }
      : { hasInconsistencies: false, inconsistencies: [] }
  }
}

// Export the copied definitions
export {
  CaseSummaryZodSchema,
  parseCaseSummary,
  adaptForCaseSummaryViewer
}
export type {
  CaseSummaryType,
  ViewerCaseSummarySchema
} 