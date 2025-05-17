// Aggregated schemas and utility functions for document processing

import { z } from 'zod';


export enum DocumentType {
    MEDICAL_REPORT = 'MEDICAL_REPORT',
    CLINICAL_NOTES = 'CLINICAL_NOTES',
    IMAGING_REPORT = 'IMAGING_REPORT',
    REHABILITATION_REPORT = 'REHABILITATION_REPORT',
    WORKCOVER_CERTIFICATE = 'WORKCOVER_CERTIFICATE',
    INSURANCE_FORM = 'INSURANCE_FORM',
    LEGAL_CORRESPONDENCE = 'LEGAL_CORRESPONDENCE',
    EMPLOYMENT_DOCUMENT = 'EMPLOYMENT_DOCUMENT',
    ALLIED_HEALTH_REPORT = 'ALLIED_HEALTH_REPORT',
    HOSPITAL_DOCUMENT = 'HOSPITAL_DOCUMENT',
    UNKNOWN = 'UNKNOWN'
}


interface DocumentTypeMapping {
    pattern: RegExp | string;
    type: DocumentType;
    confidence: number;
}

export interface TypeMatchResult {
    type: DocumentType;
    confidence: number;
    matchedPattern?: string;
    matchedTerms?: string[];
}

////////////////////////////////////////
// Base Schemas and Utility Schemas
////////////////////////////////////////

// Basic contact information schema, kept flat.
export const contactSchema = z.object({
    title: z.string().optional().nullable().describe("Person's title (e.g., Mr, Ms, Dr)"),
    name: z.string().optional().nullable().describe("Full name"),
    profession: z.string().optional().nullable().describe("Profession or role"),
    contactNumber: z.string().optional().nullable().describe("Contact telephone number"),
    address: z.string().optional().nullable().describe("Postal address"),
    email: z.string().email().optional().nullable().describe("Email address")
}).describe("Basic contact details");

// Personal identifiers: flattened to avoid nested objects.
export const personalIdentifiersSchema = z.object({
    medicareNumber: z.string().optional().nullable().describe("10-digit Medicare number"),
    IHINumber: z.string().optional().nullable().describe("16-digit IHI number"),
    insurerName: z.string().optional().nullable().describe("Name of insurer"),
    insurerCaseNumber: z.string().optional().nullable().describe("Case number assigned by insurer"),
    insurerPolicyNumber: z.string().optional().nullable().describe("Policy number from insurer")
}).describe("Personal identifiers and insurance details");

// A simple diagnosis item: flat structure.
export const diagnosisItemSchema = z.object({
    condition: z.string().optional().nullable().describe("Name of condition"),
    date: z.string().optional().nullable().describe("Date of diagnosis - STRICT FORMAT: DD/MM/YYYY"),
    status: z.string().optional().nullable().describe("Status of condition (e.g., 'ACTIVE', 'RESOLVED', 'ONGOING', 'UNKNOWN')")
});

// A simple treatment item: flat structure.
export const treatmentItemSchema = z.object({
    treatment: z.string().optional().nullable().describe("Name/description of treatment"),
    date: z.string().optional().nullable().describe("Date of treatment - STRICT FORMAT: DD/MM/YYYY"),
    provider: z.string().optional().nullable().describe("Name of treatment provider"),
    outcome: z.string().optional().nullable().describe("Outcome of treatment")
});

// A simple medication item: flat structure.
export const medicationItemSchema = z.object({
    name: z.string().optional().nullable().describe("Medication name"),
    dosage: z.string().optional().nullable().describe("Dosage and units"),
    frequency: z.string().optional().nullable().describe("Frequency of dosage"),
    prescribed: z.string().optional().nullable().describe("Prescribed date - STRICT FORMAT: DD/MM/YYYY")
});

// Base clinical content schema - arrays of flat items, no nested objects.
export const clinicalContentSchema = z.object({
    diagnosis: z.array(diagnosisItemSchema).optional().nullable().describe("List of diagnoses"),
    treatments: z.array(treatmentItemSchema).optional().nullable().describe("List of treatments"),
    medications: z.array(medicationItemSchema).optional().nullable().describe("List of medications")
}).describe("Clinical content including diagnoses, treatments, and medications");

// Work capacity: flat fields plus arrays of strings.
export const workCapacitySchema = z.object({
    status: z.string().optional().nullable().describe("Work capacity status (e.g., 'FIT', 'UNFIT', 'PARTIALLY_FIT')"),
    hours: z.number().optional().nullable().describe("Hours capable of working per day"),
    days: z.number().optional().nullable().describe("Days capable of working per week"),
    restrictions: z.array(z.string()).optional().nullable().describe("List of work restrictions"),
    reviewDate: z.string().optional().nullable().describe("Next review date - STRICT FORMAT: DD/MM/YYYY"),
    notes: z.string().optional().nullable().describe("Additional capacity notes")
}).describe("Work capacity assessment");

// Common employment fields flat.
export const employmentSchema = z.object({
    occupation: z.string().optional().nullable().describe("Current occupation or job title"),
    employerName: z.string().optional().nullable().describe("Employer name"),
    employerAddress: z.string().optional().nullable().describe("Employer address"),
    employerContact: z.string().optional().nullable().describe("Employer contact details"),
    employmentStatus: z.string().optional().nullable().describe("Employment status (e.g., 'FULL_TIME', 'PART_TIME')"),
    hoursPerWeek: z.number().optional().nullable().describe("Hours worked per week"),
    duties: z.array(z.string()).optional().nullable().describe("List of work duties"),
    modifications: z.array(z.string()).optional().nullable().describe("Work duty modifications"),
    employmentStartDate: z.string().optional().nullable().describe("Start date of employment - STRICT FORMAT: DD/MM/YYYY"),
    employmentEndDate: z.string().optional().nullable().describe("End date of employment if applicable - STRICT FORMAT: DD/MM/YYYY")
}).describe("Employment details");

// Basic injury details, kept flat.
export const injurySchema = z.object({
    dateOfInjury: z.string().optional().nullable().describe("Date of injury - STRICT FORMAT: DD/MM/YYYY"),
    mechanism: z.string().optional().nullable().describe("How injury occurred"),
    location: z.string().optional().nullable().describe("Where injury occurred"),
    bodyParts: z.array(z.string()).optional().nullable().describe("Affected body parts"),
    initialTreatment: z.string().optional().nullable().describe("Initial treatment provided"),
    reportedDate: z.string().optional().nullable().describe("Date injury was reported - DD/MM/YYYY"),
    reportedTo: z.string().optional().nullable().describe("Person injury was reported to"),
    witnesses: z.array(z.string()).optional().nullable().describe("Witnesses of injury"),
    workRelated: z.boolean().optional().nullable().describe("Whether injury is work-related")
}).describe("Injury details");

// Basic procedure details, flat.
export const procedureItemSchema = z.object({
    name: z.string().optional().nullable().describe("Name of procedure"),
    date: z.string().optional().nullable().describe("Date of procedure - DD/MM/YYYY"),
    practitioner: z.string().optional().nullable().describe("Practitioner's name"),
    organisation: z.string().optional().nullable().describe("Imaging organisation"),
    outcome: z.string().optional().nullable().describe("Outcome of procedure"),
    notes: z.string().optional().nullable().describe("Additional notes on procedure")
});

// Base imaging details flat.
export const imagingSchema = z.object({
    bodyPart: z.string().optional().nullable().describe("Body part examined"),
    date: z.string().optional().nullable().describe("Date of imaging - DD/MM/YYYY"),
    technique: z.string().optional().nullable().describe("Imaging technique used"),
    contrastUsed: z.boolean().optional().nullable().describe("Whether contrast was used")
}).describe("Imaging details");

// Basic plan or recommendations: strings in arrays.
export const recommendationsSchema = z.object({
    treatmentRecommendations: z.array(z.string()).optional().nullable().describe("Recommended treatments"),
    investigations: z.array(z.string()).optional().nullable().describe("Recommended investigations"),
    referrals: z.array(z.string()).optional().nullable().describe("Recommended referrals"),
    reviewDate: z.string().optional().nullable().describe("Recommended review date - STRICT FORMAT: DD/MM/YYYY")
}).describe("Recommendations and follow-up");

// Simple author-like info (for reports).
export const authorSchema = z.object({
    name: z.string().optional().nullable().describe("Author's name"),
    specialty: z.string().optional().nullable().describe("Author's specialty"),
    provider: z.string().optional().nullable().describe("Provider or hospital name"),
    contactDetails: z.string().optional().nullable().describe("Contact details for the author")
}).describe("Author or signatory details");

// Simple conclusion block for clinical docs.
export const conclusionsSchema = z.object({
    diagnosisConclusions: z.array(z.string()).optional().nullable().describe("Conclusive diagnoses"),
    causation: z.string().optional().nullable().describe("Causation assessment"),
    prognosis: z.string().optional().nullable().describe("Prognosis or expected outcome"),
    treatmentRecommendations: z.array(z.string()).optional().nullable().describe("Final treatment recommendations")
}).describe("Conclusions drawn from the document");

// Simple insurer details for insurance-related documents.
export const insurerSchema = z.object({
    insurerName: z.string().optional().nullable().describe("Insurer name"),
    insurerContact: z.string().optional().nullable().describe("Insurer contact details"),
    claimNumber: z.string().optional().nullable().describe("Insurance claim number")
}).describe("Insurer details");

// Basic claimant details referencing personal and contact info.
export const claimantSchema = z.object({
    title: z.string().optional().nullable(),
    name: z.string().optional().nullable(),
    profession: z.string().optional().nullable(),
    contactNumber: z.string().optional().nullable(),
    address: z.string().optional().nullable(),
    email: z.string().email().optional().nullable(),
    medicareNumber: z.string().optional().nullable(),
    IHINumber: z.string().optional().nullable(),
    insurerName: z.string().optional().nullable(),
    insurerCaseNumber: z.string().optional().nullable(),
    insurerPolicyNumber: z.string().optional().nullable()
}).describe("Claimant details");

// Basic structure for deadlines or tasks with dates.
export const actionDeadlineSchema = z.object({
    task: z.string().optional().nullable().describe("Required action"),
    date: z.string().optional().nullable().describe("Deadline date - DD/MM/YYYY")
});

////////////////////////////////////////
// Document Type Schemas
////////////////////////////////////////

// Medical Report Schema
export const medicalReportSchema = z.object({
    documentTitle: z.string().describe("A concise official title summarizing the main subject of the medical report, e.g., 'Initial Medical Report for Patient X'."),
    reportDate: z.string().optional().nullable().describe("The date the report was written, formatted as DD/MM/YYYY."),
    reportType: z.string().optional().nullable().describe("Specifies the type of medical report (e.g., initial assessment, follow-up, discharge summary).") ,
    authorName: z.string().optional().nullable().describe("The full name of the report's author.") ,
    authorSpecialty: z.string().optional().nullable().describe("The specialty or field of expertise of the author, such as Cardiology or Radiology.") ,
    authorProvider: z.string().optional().nullable().describe("The name of the provider or hospital that issued the report.") ,
    authorContact: z.string().optional().nullable().describe("Contact information for the author, including phone number and/or email address.") ,

    patientDOB: z.string().optional().nullable().describe("The patient's date of birth, formatted as DD/MM/YYYY."),
    patientGender: z.string().optional().nullable().describe("The gender of the patient (e.g., Male, Female, or Other).") ,
    patientOccupation: z.string().optional().nullable().describe("The patient's occupation or work background.") ,
    medicareNumber: z.string().optional().nullable().describe("The patient's Medicare number, if applicable."),
    IHINumber: z.string().optional().nullable().describe("The Individual Health Identifier assigned to the patient."),
    insurerName: z.string().optional().nullable().describe("The name of the patient's insurance company."),
    insurerCaseNumber: z.string().optional().nullable().describe("The case number assigned by the insurance provider."),
    insurerPolicyNumber: z.string().optional().nullable().describe("The policy number from the patient's insurance provider."),

    presentingComplaint: z.string().optional().nullable().describe("A clear description of the main complaint or reason for the medical review.") ,
    historyPresent: z.string().optional().nullable().describe("A detailed narrative of the current condition and its history.") ,

    diagnosis: z.array(diagnosisItemSchema).optional().nullable().describe("An array of diagnosis items; each should detail the diagnosed condition, certainty (e.g., 'CONFIRMED'), and its relation to the claim."),
    treatments: z.array(treatmentItemSchema).optional().nullable().describe("A list of treatments administered or recommended, with details such as treatment type, date, provider, and outcome."),
    medications: z.array(medicationItemSchema).optional().nullable().describe("A list of medications prescribed including dosage, frequency, and prescribed date."),
    procedures: z.array(procedureItemSchema).optional().nullable().describe("An array detailing procedures performed, including name, date, practitioner, and outcome."),

    clinicalHistory: z.string().optional().nullable().describe("A comprehensive narrative of the patient's overall clinical history, including previous interventions and outcomes."),
    examinationDate: z.string().optional().nullable().describe("The date of examination, formatted as DD/MM/YYYY."),
    examinationGeneral: z.string().optional().nullable().describe("General observations from the physical examination."),
    examinationSpecific: z.string().optional().nullable().describe("Specific findings and detailed observations noted during the examination."),

    diagnoses: z.array(z.object({
        condition: z.string().optional().nullable().describe("The name of the diagnosed condition."),
        certainty: z.string().optional().nullable().describe("Indicates the certainty of the diagnosis, e.g., 'CONFIRMED' or 'SUSPECTED'."),
        relation: z.string().optional().nullable().describe("Describes the relation between the diagnosis and the claim, e.g., 'DIRECT' or 'INDIRECT'.")
    })).optional().nullable().describe("A list of detailed diagnoses from the assessment."),

    causation: z.string().optional().nullable().describe("A comprehensive assessment of the causal factors contributing to the patient's condition."),
    prognosis: z.string().optional().nullable().describe("The expected progression or outcome of the condition."),
    permanence: z.string().optional().nullable().describe("An evaluation of whether the impairment is permanent."),

    workCapacityStatus: z.string().optional().nullable().describe("The current status of the patient's ability to work (e.g., 'Fit', 'Unfit')."),
    workCapacityHours: z.number().optional().nullable().describe("The estimated number of work hours per day the patient can safely manage."),
    workCapacityDays: z.number().optional().nullable().describe("The estimated number of work days per week the patient can work."),
    workCapacityRestrictions: z.array(z.string()).optional().nullable().describe("A list detailing any restrictions or limitations on the patient's work capacity."),
    workCapacityReviewDate: z.string().optional().nullable().describe("The scheduled date for re-evaluating the patient's work capacity, formatted as DD/MM/YYYY."),
    workCapacityNotes: z.string().optional().nullable().describe("Additional notes regarding the patient's work capacity.") ,

    treatmentRecommendations: z.array(z.string()).optional().nullable().describe("Recommended treatments or interventions based on the assessment."),
    recommendedInvestigations: z.array(z.string()).optional().nullable().describe("Diagnostic investigations suggested for further evaluation."),
    recommendedReferrals: z.array(z.string()).optional().nullable().describe("Specialist referrals recommended, if any."),
    recommendedReviewDate: z.string().optional().nullable().describe("The recommended follow-up or review date, formatted as DD/MM/YYYY."),

    diagnosisConclusions: z.array(z.string()).optional().nullable().describe("Conclusive statements regarding the diagnoses made."),
    conclusionCausation: z.string().optional().nullable().describe("Final assessment regarding the causal factors of the condition."),
    conclusionPrognosis: z.string().optional().nullable().describe("Final prognosis derived from the assessment."),
    conclusionTreatmentRecommendations: z.array(z.string()).optional().nullable().describe("Final treatment recommendations based on the overall evaluation.")
}).describe("Medical Report Schema");

// Clinical Notes Schema
export const clinicalNotesSchema = z.object({
    documentTitle: z.string().describe("A concise title summarizing the clinical note, for example 'Clinical Consultation Note'."),
    noteDate: z.string().optional().nullable().describe("The date when the note was recorded, formatted as DD/MM/YYYY."),
    providerTitle: z.string().optional().nullable().describe("The title or designation of the healthcare provider (e.g., Dr, Nurse Practitioner).") ,
    providerName: z.string().optional().nullable().describe("The full name of the healthcare provider responsible for the note."),
    providerProfession: z.string().optional().nullable().describe("The profession or specialty of the provider."),
    providerContactNumber: z.string().optional().nullable().describe("The contact telephone number of the provider."),
    providerAddress: z.string().optional().nullable().describe("The complete address of the healthcare facility or provider."),
    providerEmail: z.string().email().optional().nullable().describe("A valid email address for the provider."),

    consultationReason: z.string().optional().nullable().describe("A clear explanation of the patient's reason for seeking medical consultation."),
    consultationHistory: z.string().optional().nullable().describe("A detailed history of the presenting complaint and previous related symptoms."),
    consultationExamination: z.string().optional().nullable().describe("Key findings and observations derived from the patient examination."),
    consultationPlan: z.string().optional().nullable().describe("The treatment plan and next steps as decided during the consultation.")
}).describe("Clinical Notes Schema");

// Imaging Report Schema
export const imagingReportSchema = z.object({
    documentTitle: z.string().describe("A concise title summarizing the imaging report, for example 'Chest X-Ray Report'."),
    reportDate: z.string().optional().nullable().describe("The date the imaging report was generated, formatted as DD/MM/YYYY."),
    examType: z.string().optional().nullable().describe("Specifies the type of imaging exam (e.g., X-Ray, MRI, CT scan)."),

    medicareNumber: z.string().optional().nullable().describe("The patient's Medicare number, if applicable."),
    IHINumber: z.string().optional().nullable().describe("The patient's Individual Health Identifier (IHI) number."),
    insurerName: z.string().optional().nullable().describe("The name of the patient's insurer."),
    insurerCaseNumber: z.string().optional().nullable().describe("The case number assigned by the insurer."),
    insurerPolicyNumber: z.string().optional().nullable().describe("The insurer's policy number."),

    indication: z.string().optional().nullable().describe("The clinical indication or reason for the imaging exam."),
    clinicalHistory: z.string().optional().nullable().describe("Relevant clinical background that prompted the imaging exam."),
    findingsDescription: z.string().optional().nullable().describe("A detailed description of the findings observed in the imaging exam."),
    findingsImpression: z.string().optional().nullable().describe("The radiologist's overall impression or summary interpretation of the imaging findings."),
    findingsComparison: z.string().optional().nullable().describe("A comparison of the current imaging exam with any previous exams, if available."),

    radiologistName: z.string().optional().nullable().describe("The full name of the radiologist who interpreted the images."),
    radiologistProvider: z.string().optional().nullable().describe("The name of the imaging facility or provider."),
    radiologistSignature: z.boolean().optional().nullable().describe("Indicates whether the radiologist has signed off on the report (true or false).")
}).describe("Imaging Report Schema");

// Rehabilitation Report Schema
export const rehabilitationReportSchema = z.object({
    documentTitle: z.string().describe("A concise title summarizing the rehabilitation report, such as 'Initial Rehabilitation Report'."),
    reportDate: z.string().optional().nullable().describe("The date the rehabilitation report was written (DD/MM/YYYY)."),
    reportType: z.string().optional().nullable().describe("Specifies the type of rehabilitation report (e.g., INITIAL, PROGRESS).") ,

    medicareNumber: z.string().optional().nullable().describe("The patient's Medicare number, if available."),
    IHINumber: z.string().optional().nullable().describe("The patient's Individual Health Identifier (IHI) number."),
    insurerName: z.string().optional().nullable().describe("The name of the insurer covering the patient's treatment."),
    insurerCaseNumber: z.string().optional().nullable().describe("The case number from the insurer."),
    insurerPolicyNumber: z.string().optional().nullable().describe("The insurer's policy number."),

    occupation: z.string().optional().nullable().describe("The patient's occupation.") ,
    employerName: z.string().optional().nullable().describe("The name of the patient's employer."),
    employerAddress: z.string().optional().nullable().describe("The full address of the employer."),
    employerContact: z.string().optional().nullable().describe("Contact details for the employer."),
    employmentStatus: z.string().optional().nullable().describe("The patient's employment status (e.g., Full-time, Part-time).") ,
    hoursPerWeek: z.number().optional().nullable().describe("The number of hours the patient is expected to work per week."),
    duties: z.array(z.string()).optional().nullable().describe("A list of the patient's work duties."),
    modifications: z.array(z.string()).optional().nullable().describe("Any modifications to the patient's work duties."),
    employmentStartDate: z.string().optional().nullable().describe("The start date of employment, formatted as DD/MM/YYYY."),
    employmentEndDate: z.string().optional().nullable().describe("The end date of employment, if applicable, formatted as DD/MM/YYYY."),

    providerName: z.string().optional().nullable().describe("The name of the rehabilitation provider."),
    providerContact: z.string().optional().nullable().describe("Contact details for the rehabilitation provider."),
    providerReference: z.string().optional().nullable().describe("A reference number or identifier provided by the rehabilitation provider."),

    rehabBarriers: z.array(z.string()).optional().nullable().describe("List any barriers to returning to work identified during rehabilitation."),
    rehabGoals: z.array(z.object({
        description: z.string().optional().nullable().describe("Description of the rehabilitation goal."),
        achieved: z.boolean().optional().nullable().describe("Indicates whether the goal was achieved (true or false)."),
        date: z.string().optional().nullable().describe("The date when the goal was achieved or assessed, formatted as DD/MM/YYYY.")
    })).optional().nullable().describe("Detailed rehabilitation goals with achievement status and dates."),
    rehabInterventions: z.array(z.string()).optional().nullable().describe("Interventions implemented during rehabilitation."),
    rehabProgress: z.string().optional().nullable().describe("Overall progress observed during the rehabilitation process."),

    rehabRecommendations: z.array(z.string()).optional().nullable().describe("Recommendations for future rehabilitation interventions."),

    rehabCosts: z.array(z.object({
        service: z.string().optional().nullable().describe("The rehabilitation service provided."),
        amount: z.number().optional().nullable().describe("The cost associated with the service."),
        approved: z.boolean().optional().nullable().describe("Indicates whether the cost was approved (true or false).")
    })).optional().nullable().describe("Details of rehabilitation-related costs."),
}).describe("Rehabilitation Report Schema");

// WorkCover Certificate Schema
export const workCoverCertificateSchema = z.object({
    documentTitle: z.string().describe("A concise title for the workCover certificate, for example 'WorkCover Certificate for Injury'."),
    certificateDate: z.string().optional().nullable().describe("The date the certificate was issued, formatted as DD/MM/YYYY."),
    certificateType: z.string().optional().nullable().describe("The type of certificate (e.g., INITIAL, FINAL)."),

    medicareNumber: z.string().optional().nullable().describe("The patient's Medicare number, if applicable."),
    IHINumber: z.string().optional().nullable().describe("The patient's Individual Health Identifier (IHI) number."),
    insurerName: z.string().optional().nullable().describe("The name of the insurer."),
    insurerCaseNumber: z.string().optional().nullable().describe("The case number assigned by the insurer."),
    insurerPolicyNumber: z.string().optional().nullable().describe("The policy number from the insurer."),

    claimNumber: z.string().optional().nullable().describe("The WorkCover claim number."),
    occupation: z.string().optional().nullable().describe("The patient's occupation at the time of injury."),
    employerName: z.string().optional().nullable().describe("The name of the employer."),
    employerAddress: z.string().optional().nullable().describe("The full address of the employer."),
    employerContact: z.string().optional().nullable().describe("Contact details of the employer."),
    employmentStatus: z.string().optional().nullable().describe("The employment status of the patient (e.g., Permanent, Casual)."),
    hoursPerWeek: z.number().optional().nullable().describe("Number of hours the patient is expected to work per week."),
    duties: z.array(z.string()).optional().nullable().describe("A list of job responsibilities or duties."),
    modifications: z.array(z.string()).optional().nullable().describe("Any modifications made to job responsibilities."),
    employmentStartDate: z.string().optional().nullable().describe("Employment start date, formatted as DD/MM/YYYY."),
    employmentEndDate: z.string().optional().nullable().describe("Employment termination date, if applicable, formatted as DD/MM/YYYY."),

    dateOfInjury: z.string().optional().nullable().describe("The date on which the injury occurred, formatted as DD/MM/YYYY."),
    mechanism: z.string().optional().nullable().describe("A description of how the injury occurred."),
    location: z.string().optional().nullable().describe("The location where the injury took place."),
    bodyParts: z.array(z.string()).optional().nullable().describe("A list of body parts affected by the injury."),
    initialTreatment: z.string().optional().nullable().describe("A description of the initial treatment provided."),
    reportedDate: z.string().optional().nullable().describe("The date the injury was reported, formatted as DD/MM/YYYY."),
    reportedTo: z.string().optional().nullable().describe("The name or role of the individual to whom the injury was reported."),
    witnesses: z.array(z.string()).optional().nullable().describe("Names or descriptions of witnesses to the injury."),
    workRelated: z.boolean().optional().nullable().describe("Indicates if the injury is work related (true or false)."),

    workCapacityStatus: z.string().optional().nullable().describe("An assessment of the patient's work capacity status following the injury."),
    workCapacityHours: z.number().optional().nullable().describe("The estimated number of work hours per day the patient can manage after the injury."),
    workCapacityDays: z.number().optional().nullable().describe("The estimated number of work days per week the patient can work post-injury."),
    workCapacityRestrictions: z.array(z.string()).optional().nullable().describe("Any limitations or restrictions on the patient's work capacity."),
    workCapacityReviewDate: z.string().optional().nullable().describe("The date scheduled for reviewing the patient's work capacity, formatted as DD/MM/YYYY."),
    workCapacityNotes: z.string().optional().nullable().describe("Additional notes regarding post-injury work capacity."),

    currentTreatments: z.array(z.string()).optional().nullable().describe("Current treatments being undertaken by the patient."),
    plannedTreatments: z.array(z.string()).optional().nullable().describe("Treatments planned for the future."),
    treatmentReferrals: z.array(z.string()).optional().nullable().describe("Any referrals to specialists or other services related to the treatment."),

    nextReview: z.string().optional().nullable().describe("The date for the next review of the certificate, formatted as DD/MM/YYYY.")
}).describe("WorkCover Certificate Schema");

// Allied Health Report Schema
export const alliedHealthReportSchema = z.object({
    documentTitle: z.string().describe("A concise title summarizing the allied health report, e.g., 'Physiotherapy Assessment Report'."),
    reportDate: z.string().optional().nullable().describe("The date the report was generated, formatted as DD/MM/YYYY."),
    profession: z.string().optional().nullable().describe("The allied health profession involved, described in plain text (e.g., Physiotherapy, Occupational Therapy)."),

    treatmentSessionNumber: z.number().optional().nullable().describe("The session number for the treatment, if applicable."),
    treatmentDate: z.string().optional().nullable().describe("The date the treatment session occurred, formatted as DD/MM/YYYY."),
    treatmentModalities: z.array(z.string()).optional().nullable().describe("A list of treatment modalities used during the session."),
    treatmentResponse: z.string().optional().nullable().describe("The patient's response to the treatment administered."),
    treatmentProgress: z.string().optional().nullable().describe("A summary of the patient's progress over the course of treatment."),

    assessmentFindings: z.string().optional().nullable().describe("Clinical findings from the allied health assessment."),
    assessmentMeasures: z.array(z.object({
        type: z.string().optional().nullable().describe("The type of measure or assessment conducted."),
        value: z.string().optional().nullable().describe("The value or result of the measure."),
        change: z.string().optional().nullable().describe("An indication of change compared to previous measures.")
    })).optional().nullable().describe("A detailed list of assessments and their corresponding measures."),

    planFrequency: z.string().optional().nullable().describe("The frequency with which the treatment plan is to be administered (e.g., weekly, biweekly)."),
    planDuration: z.string().optional().nullable().describe("The overall duration of the treatment plan (e.g., in weeks or months)."),
    planGoals: z.array(z.string()).optional().nullable().describe("A list of goals for the treatment plan.")
}).describe("Allied Health Report Schema");

// Legal Correspondence Schema
export const legalCorrespondenceSchema = z.object({
    documentTitle: z.string().describe("A concise title summarizing the legal correspondence, for example 'Legal Correspondence Regarding Patient Claim'."),
    letterDate: z.string().optional().nullable().describe("The date the letter was written, formatted as DD/MM/YYYY."),

    authorTitle: z.string().optional().nullable().describe("The title or designation of the letter's author (e.g., Dr, Mr, Ms).") ,
    authorName: z.string().optional().nullable().describe("The full name of the author of the correspondence."),
    authorProfession: z.string().optional().nullable().describe("The profession or role of the author, described in plain text."),
    authorContactNumber: z.string().optional().nullable().describe("The contact telephone number of the author."),
    authorAddress: z.string().optional().nullable().describe("The mailing address of the author."),
    authorEmail: z.string().email().optional().nullable().describe("A valid email address for the author."),
    authorFirm: z.string().optional().nullable().describe("The name of the legal firm representing the author, if applicable."),

    recipientTitle: z.string().optional().nullable().describe("The title or designation of the letter's recipient.") ,
    recipientName: z.string().optional().nullable().describe("The full name of the recipient."),
    recipientProfession: z.string().optional().nullable().describe("The profession or role of the recipient, in plain text."),
    recipientContactNumber: z.string().optional().nullable().describe("The contact telephone number for the recipient."),
    recipientAddress: z.string().optional().nullable().describe("The mailing address of the recipient."),
    recipientEmail: z.string().email().optional().nullable().describe("A valid email address for the recipient."),

    subject: z.string().optional().nullable().describe("A clear subject line summarizing the purpose of the correspondence."),
    body: z.string().optional().nullable().describe("The full content of the letter or correspondence, detailing all necessary information."),
    requests: z.array(z.string()).optional().nullable().describe("A list of specific requests or actions being asked for in the correspondence."),
    deadlines: z.array(actionDeadlineSchema).optional().nullable().describe("A list of deadlines or essential dates mentioned in the correspondence, each with a description.")
}).describe("Legal Correspondence Schema");

// Employment Document Schema
export const employmentDocumentSchema = z.object({
    documentTitle: z.string().describe("A concise title summarizing the employment document, for example 'Employment Verification Document'."),
    documentDate: z.string().optional().nullable().describe("The date the employment document was issued, formatted as DD/MM/YYYY."),
    type: z.string().optional().nullable().describe("A plain text description of the type of employment document."),

    employerTitle: z.string().optional().nullable().describe("The title or designation of the employer."),
    employerName: z.string().optional().nullable().describe("The full name of the employer."),
    employerProfession: z.string().optional().nullable().describe("A description of the employer's industry or the role within the organization (if applicable)."),
    employerContactNumber: z.string().optional().nullable().describe("The contact telephone number for the employer."),
    employerAddress: z.string().optional().nullable().describe("The full mailing address of the employer."),
    employerEmail: z.string().email().optional().nullable().describe("A valid email address for the employer."),

    employeeTitle: z.string().optional().nullable().describe("The title or designation of the employee (e.g., Mr, Ms, Dr).") ,
    employeeName: z.string().optional().nullable().describe("The full name of the employee."),
    employeeProfession: z.string().optional().nullable().describe("The professional role or job title of the employee."),
    employeeContactNumber: z.string().optional().nullable().describe("The contact telephone number for the employee."),
    employeeAddress: z.string().optional().nullable().describe("The complete mailing address of the employee."),
    employeeEmail: z.string().email().optional().nullable().describe("A valid email address for the employee."),
    employeePosition: z.string().optional().nullable().describe("A plain text description of the employee's position or role within the organization."),
    employeeStartDate: z.string().optional().nullable().describe("The date when the employee started, formatted as DD/MM/YYYY."),

    duties: z.array(z.string()).optional().nullable().describe("A list of the employee's duties or job responsibilities."),
    requirements: z.array(z.string()).optional().nullable().describe("A list of requirements or qualifications necessary for the position."),
    modifications: z.array(z.string()).optional().nullable().describe("Any modifications to the employee's duties or role, noted in plain text."),
}).describe("Employment Document Schema");

// Insurance Form Schema
export const insuranceFormSchema = z.object({
    documentTitle: z.string().describe("A concise title for the insurance form, such as 'Patient Insurance Claim Form'."),
    formDate: z.string().optional().nullable().describe("The date the form was completed, formatted as DD/MM/YYYY."),
    formType: z.string().optional().nullable().describe("The type of insurance form or claim, described in plain text."),

    insurerName: z.string().optional().nullable().describe("The name of the insurer."),
    insurerContact: z.string().optional().nullable().describe("Contact details for the insurer, such as phone and email."),
    insurerClaimNumber: z.string().optional().nullable().describe("The claim number associated with the insurer."),

    claimantTitle: z.string().optional().nullable().describe("The title of the claimant (e.g., Mr, Mrs, Ms, Dr)."),
    claimantName: z.string().optional().nullable().describe("The full name of the claimant."),
    claimantProfession: z.string().optional().nullable().describe("The profession of the claimant."),
    claimantContactNumber: z.string().optional().nullable().describe("The contact number for the claimant."),
    claimantAddress: z.string().optional().nullable().describe("The full postal address of the claimant."),
    claimantEmail: z.string().email().optional().nullable().describe("A valid email address for the claimant."),
    claimantMedicareNumber: z.string().optional().nullable().describe("The claimant's Medicare number, if applicable."),
    claimantIHINumber: z.string().optional().nullable().describe("The claimant's Individual Health Identifier number."),
    claimantInsurerName: z.string().optional().nullable().describe("The name of the claimant's insurer."),
    claimantInsurerCaseNumber: z.string().optional().nullable().describe("The case number assigned to the claimant by the insurer."),
    claimantInsurerPolicyNumber: z.string().optional().nullable().describe("The claimant's insurance policy number."),

    claimType: z.string().optional().nullable().describe("A plain text description of the type of claim being made."),
    claimDate: z.string().optional().nullable().describe("The date the claim was made, formatted as DD/MM/YYYY."),
    claimStatus: z.string().optional().nullable().describe("The current status of the claim, described in plain text."),
    claimDetails: z.string().optional().nullable().describe("A detailed narrative describing the claim and any related circumstances.")
}).describe("Insurance Form Schema");

// Hospital Document Schema
export const hospitalDocumentSchema = z.object({
    documentTitle: z.string().describe("A concise title summarizing the hospital document, for example 'Hospital Discharge Summary'."),
    documentDate: z.string().optional().nullable().describe("The date the hospital document was issued, formatted as DD/MM/YYYY."),
    hospitalName: z.string().optional().nullable().describe("The name of the hospital where the document originated."),
    ward: z.string().optional().nullable().describe("The ward or department associated with the document."),

    medicareNumber: z.string().optional().nullable().describe("The patient's Medicare number, if applicable."),
    IHINumber: z.string().optional().nullable().describe("The patient's Individual Health Identifier (IHI) number."),
    insurerName: z.string().optional().nullable().describe("The name of the patient's insurer."),
    insurerCaseNumber: z.string().optional().nullable().describe("The case number assigned by the insurer."),
    insurerPolicyNumber: z.string().optional().nullable().describe("The insurer's policy number."),
    patientDOB: z.string().optional().nullable().describe("The patient's date of birth, formatted as DD/MM/YYYY."),
    patientGender: z.string().optional().nullable().describe("The gender of the patient."),
    patientOccupation: z.string().optional().nullable().describe("The patient's occupation."),

    clinicalSummary: z.string().optional().nullable().describe("A summary of the patient's clinical status or reason for admission."),
    treatmentType: z.string().optional().nullable().describe("The type of treatment provided during the hospital stay."),
    treatmentProvider: z.string().optional().nullable().describe("The name of the provider who administered the treatment."),
    treatmentDate: z.string().optional().nullable().describe("The date the treatment was administered, formatted as DD/MM/YYYY."),
    treatmentOngoing: z.boolean().optional().nullable().describe("Indicates whether treatment is ongoing (true or false)."),
    treatmentFrequency: z.string().optional().nullable().describe("The frequency of the treatment sessions, if applicable."),
    treatmentOutcome: z.string().optional().nullable().describe("The outcome of the treatment provided."),
    treatmentNotes: z.string().optional().nullable().describe("Additional notes regarding the treatment provided."),

    dischargePlan: z.string().optional().nullable().describe("The discharge plan or post-hospitalization instructions, if available.")
}).describe("Hospital Document Schema");

// Correspondence Schema
export const correspondenceSchema = z.object({
    documentTitle: z.string().describe("A concise title summarizing the correspondence, for example 'Medical Correspondence Regarding Claim'."),
    letterDate: z.string().optional().nullable().describe("The date the letter or correspondence was written, formatted as DD/MM/YYYY."),
    
    authorTitle: z.string().optional().nullable().describe("The title or designation of the sender (e.g., Dr, Mr, Ms)."),
    authorName: z.string().optional().nullable().describe("The full name of the sender of the correspondence."),
    authorProfession: z.string().optional().nullable().describe("The profession or role of the sender, described in plain text."),
    authorContactNumber: z.string().optional().nullable().describe("The contact telephone number of the sender."),
    authorAddress: z.string().optional().nullable().describe("The mailing address of the sender."),
    authorEmail: z.string().email().optional().nullable().describe("A valid email address for the sender."),
    authorOrganization: z.string().optional().nullable().describe("The organization or institution the sender is associated with."),
    
    recipientTitle: z.string().optional().nullable().describe("The title or designation of the recipient (e.g., Dr, Mr, Ms)."),
    recipientName: z.string().optional().nullable().describe("The full name of the recipient."),
    recipientProfession: z.string().optional().nullable().describe("The profession or role of the recipient, in plain text."),
    recipientContactNumber: z.string().optional().nullable().describe("The contact telephone number for the recipient."),
    recipientAddress: z.string().optional().nullable().describe("The mailing address of the recipient."),
    recipientEmail: z.string().email().optional().nullable().describe("A valid email address for the recipient."),

    subject: z.string().optional().nullable().describe("The subject line that concisely summarizes the purpose of the correspondence."),
    body: z.string().optional().nullable().describe("The full body content of the correspondence, containing all necessary details and context."),
    
    clinicalSummary: z.string().optional().nullable().describe("Any clinical summary mentioned in the letter"),
    recommendations: z.array(z.string()).optional().nullable().describe("Any recommended actions, treatments, or follow-ups mentioned"),
    keyDates: z.array(z.object({
        label: z.string().optional().nullable().describe("Label or description of the date (e.g., 'Appointment', 'Follow-up')"),
        date: z.string().optional().nullable().describe("Relevant date - STRICT FORMAT: DD/MM/YYYY")
    })).optional().nullable().describe("List of key dates mentioned in the correspondence"),
    
    requests: z.array(z.string()).optional().nullable().describe("Requests or actions requested of the recipient"),
    attachments: z.array(z.string()).optional().nullable().describe("List of any attachments mentioned in the letter"),

    closingRemarks: z.string().optional().nullable().describe("Closing remarks or concluding note"),
    signatureBlock: z.string().optional().nullable().describe("Author's signature block if mentioned")
}).describe("Generic Correspondence Schema for a standard letter with medical relevance");

// Unknown Document Schema
export const unknownSchema = z.object({
    documentTitle: z.string().describe("A concise title for an unknown document type. This title should reflect the nature of the information extracted, even if the document type is not recognized."),
    notes: z.string().optional().nullable().describe("Extracted text or notes for unknown document type, providing any available information.")
}).describe("Unknown Document Schema");

// Consolidated object of all document schemas
export const documentSchemas = {
    MEDICAL_REPORT: medicalReportSchema,
    CLINICAL_NOTES: clinicalNotesSchema,
    IMAGING_REPORT: imagingReportSchema,
    REHABILITATION_REPORT: rehabilitationReportSchema,
    WORKCOVER_CERTIFICATE: workCoverCertificateSchema,
    INSURANCE_FORM: insuranceFormSchema,
    LEGAL_CORRESPONDENCE: legalCorrespondenceSchema,
    EMPLOYMENT_DOCUMENT: employmentDocumentSchema,
    ALLIED_HEALTH_REPORT: alliedHealthReportSchema,
    HOSPITAL_DOCUMENT: hospitalDocumentSchema,
    UNKNOWN: unknownSchema
};

////////////////////////////////////////
// Schema Extension Utilities
////////////////////////////////////////

type Primitive = string | number | boolean | null | undefined;
export type DeepPartial<T> = T extends Primitive
  ? T
  : T extends Array<infer U>
  ? Array<DeepPartial<U>>
  : T extends object
  ? { [K in keyof T]?: DeepPartial<T[K]> }
  : T;

export type MergeSchemas<T extends z.ZodRawShape, U extends z.ZodRawShape> = z.ZodObject<T & U>;

export function mergeSchemas<
    T extends z.ZodRawShape,
    U extends z.ZodRawShape
>(schema1: z.ZodObject<T>, schema2: z.ZodObject<U>): MergeSchemas<T, U> {
    return z.object({ ...schema1.shape, ...schema2.shape });
} 

const DOCUMENT_TYPE_MAPPINGS: DocumentTypeMapping[] = [
    // MEDICAL REPORTS 
    { 
        pattern: /pathology\s*(report|result|overview)/i,
        type: DocumentType.MEDICAL_REPORT,
        confidence: 0.9
    },
    {
        pattern: /(laboratory|lab)\s*(test|result)/i,
        type: DocumentType.MEDICAL_REPORT,
        confidence: 0.9
    },
    {
        pattern: /(blood|urine|specimen)\s*(test|analysis)/i,
        type: DocumentType.MEDICAL_REPORT,
        confidence: 0.9
    },
    {
        pattern: /medical\s*(report|assessment|examination|record|documentation)/i,
        type: DocumentType.MEDICAL_REPORT,
        confidence: 1.0,
    },
    {
        pattern: /health\s*(assessment|record|report|summary)/i,
        type: DocumentType.MEDICAL_REPORT,
        confidence: 0.9
    },
    {
        pattern: /clinical\s*(assessment|report|documentation|summary)/i,
        type: DocumentType.MEDICAL_REPORT,
        confidence: 0.9
    },
    {
        pattern: /(specialist|physician|doctor)('s)?\s*(report|assessment|review)/i,
        type: DocumentType.MEDICAL_REPORT,
        confidence: 0.95
    },
    {
        pattern: /medical\s*(history|findings|observations)/i,
        type: DocumentType.MEDICAL_REPORT,
        confidence: 0.85
    },
    {
        pattern: /(comprehensive|detailed)\s*medical\s*(assessment|evaluation)/i,
        type: DocumentType.MEDICAL_REPORT,
        confidence: 0.95
    },
    {
        pattern: /patient\s*(medical|health)\s*(summary|record)/i,
        type: DocumentType.MEDICAL_REPORT,
        confidence: 0.85
    },
    {
        pattern: /(immunisation|vaccination|vaccine)\s*(record|history|list)/i,
        type: DocumentType.MEDICAL_REPORT,
        confidence: 0.9
    },
    {
        pattern: /medicines?\s*(list|view|record)/i,
        type: DocumentType.MEDICAL_REPORT,
        confidence: 0.9
    },
    {
        pattern: /pathology\s*(reports?|results?|overview)/i,
        type: DocumentType.MEDICAL_REPORT,
        confidence: 0.9
    },

    // CLINICAL NOTES
    {
        pattern: /clinical\s*notes?/i,
        type: DocumentType.CLINICAL_NOTES,
        confidence: 1.0
    },
    {
        pattern: /(progress|consultation|follow[\s-]?up|treatment)\s*notes?/i,
        type: DocumentType.CLINICAL_NOTES,
        confidence: 0.95
    },
    {
        pattern: /soap\s*notes?/i,
        type: DocumentType.CLINICAL_NOTES,
        confidence: 1.0
    },
    {
        pattern: /(subjective|objective|assessment|plan)\s*notes?/i,
        type: DocumentType.CLINICAL_NOTES,
        confidence: 0.9
    },
    {
        pattern: /doctor('s)?\s*notes?/i,
        type: DocumentType.CLINICAL_NOTES,
        confidence: 0.85
    },
    {
        pattern: /(daily|weekly)\s*(progress|clinical)\s*notes?/i,
        type: DocumentType.CLINICAL_NOTES,
        confidence: 0.9
    },
    {
        pattern: /patient\s*progress\s*notes?/i,
        type: DocumentType.CLINICAL_NOTES,
        confidence: 0.9
    },

    // IMAGING REPORTS
    {
        pattern: /(radiology|imaging|diagnostic)\s*(report|study|examination|results?)/i,
        type: DocumentType.IMAGING_REPORT,
        confidence: 1.0
    },
    {
        pattern: /x-?ray\s*(report|study|examination|results?)/i,
        type: DocumentType.IMAGING_REPORT,
        confidence: 0.95
    },
    {
        pattern: /(mri|ct|pet|ultrasound|sonogram)\s*(report|study|scan|results?)/i,
        type: DocumentType.IMAGING_REPORT,
        confidence: 0.95
    },
    {
        pattern: /radiological\s*(findings|assessment|interpretation)/i,
        type: DocumentType.IMAGING_REPORT,
        confidence: 0.9
    },
    {
        pattern: /diagnostic\s*imaging\s*(report|results?)/i,
        type: DocumentType.IMAGING_REPORT,
        confidence: 0.95
    },
    {
        pattern: /(nuclear\s*medicine|contrast)\s*(study|examination|scan)/i,
        type: DocumentType.IMAGING_REPORT,
        confidence: 0.9
    },

    // REHABILITATION REPORTS
    {
        pattern: /rehabilitation\s*(report|assessment|plan|progress)/i,
        type: DocumentType.REHABILITATION_REPORT,
        confidence: 1.0
    },
    {
        pattern: /(physio|physical)\s*therapy\s*(report|assessment|plan)/i,
        type: DocumentType.REHABILITATION_REPORT,
        confidence: 0.95
    },
    {
        pattern: /functional\s*(capacity|assessment|evaluation)\s*report/i,
        type: DocumentType.REHABILITATION_REPORT,
        confidence: 0.9
    },
    {
        pattern: /rehab(ilitation)?\s*(progress|status|update)/i,
        type: DocumentType.REHABILITATION_REPORT,
        confidence: 0.9
    },
    {
        pattern: /therapy\s*(progress|assessment|plan|report)/i,
        type: DocumentType.REHABILITATION_REPORT,
        confidence: 0.85
    },

    // WORKCOVER CERTIFICATES
    {
        pattern: /work\s*cover\s*(certificate|report|assessment)/i,
        type: DocumentType.WORKCOVER_CERTIFICATE,
        confidence: 1.0
    },
    {
        pattern: /certificate\s*of\s*capacity/i,
        type: DocumentType.WORKCOVER_CERTIFICATE,
        confidence: 1.0
    },
    {
        pattern: /workers?\s*compensation\s*(certificate|report)/i,
        type: DocumentType.WORKCOVER_CERTIFICATE,
        confidence: 0.95
    },
    {
        pattern: /work\s*capacity\s*(certificate|assessment)/i,
        type: DocumentType.WORKCOVER_CERTIFICATE,
        confidence: 0.95
    },
    {
        pattern: /fitness\s*(for|to)\s*work\s*(certificate|assessment)/i,
        type: DocumentType.WORKCOVER_CERTIFICATE,
        confidence: 0.9
    },
    {
        pattern: /return\s*to\s*work\s*(certificate|plan|assessment)/i,
        type: DocumentType.WORKCOVER_CERTIFICATE,
        confidence: 0.9
    },

    // INSURANCE FORMS
    {
        pattern: /insurance\s*(claim|form|assessment|report)/i,
        type: DocumentType.INSURANCE_FORM,
        confidence: 1.0
    },
    {
        pattern: /claim\s*(form|documentation|paperwork)/i,
        type: DocumentType.INSURANCE_FORM,
        confidence: 0.9
    },
    {
        pattern: /(health|medical|disability)\s*insurance\s*(form|claim)/i,
        type: DocumentType.INSURANCE_FORM,
        confidence: 0.95
    },
    {
        pattern: /insurance\s*(provider|company)\s*(form|documentation)/i,
        type: DocumentType.INSURANCE_FORM,
        confidence: 0.9
    },
    {
        pattern: /policy\s*(claim|form|documentation)/i,
        type: DocumentType.INSURANCE_FORM,
        confidence: 0.85
    },

    // LEGAL CORRESPONDENCE
    {
        pattern: /legal\s*(correspondence|letter|document|communication)/i,
        type: DocumentType.LEGAL_CORRESPONDENCE,
        confidence: 1.0
    },
    {
        pattern: /without\s*prejudice/i,
        type: DocumentType.LEGAL_CORRESPONDENCE,
        confidence: 0.95
    },
    {
        pattern: /(solicitor|lawyer|attorney|legal\s*representative)('s)?\s*(letter|correspondence)/i,
        type: DocumentType.LEGAL_CORRESPONDENCE,
        confidence: 0.95
    },
    {
        pattern: /legal\s*(matter|proceedings|case)\s*(correspondence|documentation)/i,
        type: DocumentType.LEGAL_CORRESPONDENCE,
        confidence: 0.9
    },
    {
        pattern: /(confidential|privileged)\s*legal\s*communication/i,
        type: DocumentType.LEGAL_CORRESPONDENCE,
        confidence: 0.9
    },

    // EMPLOYMENT DOCUMENTS
    {
        pattern: /employment\s*(record|document|report|assessment)/i,
        type: DocumentType.EMPLOYMENT_DOCUMENT,
        confidence: 1.0
    },
    {
        pattern: /job\s*(description|specification|requirements)/i,
        type: DocumentType.EMPLOYMENT_DOCUMENT,
        confidence: 0.95
    },
    {
        pattern: /workplace\s*(assessment|evaluation|report)/i,
        type: DocumentType.EMPLOYMENT_DOCUMENT,
        confidence: 0.9
    },
    {
        pattern: /occupational\s*(health|safety|assessment)\s*report/i,
        type: DocumentType.EMPLOYMENT_DOCUMENT,
        confidence: 0.9
    },
    {
        pattern: /work\s*(duties|responsibilities|requirements)\s*document/i,
        type: DocumentType.EMPLOYMENT_DOCUMENT,
        confidence: 0.85
    },

    // ALLIED HEALTH REPORTS
    {
        pattern: /allied\s*health\s*(report|assessment|review)/i,
        type: DocumentType.ALLIED_HEALTH_REPORT,
        confidence: 1.0
    },
    {
        pattern: /(physiotherapy|physical\s*therapy)\s*(report|assessment)/i,
        type: DocumentType.ALLIED_HEALTH_REPORT,
        confidence: 0.95
    },
    {
        pattern: /(occupational|speech|language)\s*therapy\s*(report|assessment)/i,
        type: DocumentType.ALLIED_HEALTH_REPORT,
        confidence: 0.95
    },
    {
        pattern: /(podiatry|chiropractic|osteopathy)\s*(report|assessment)/i,
        type: DocumentType.ALLIED_HEALTH_REPORT,
        confidence: 0.9
    },
    {
        pattern: /therapeutic\s*(intervention|assessment|report)/i,
        type: DocumentType.ALLIED_HEALTH_REPORT,
        confidence: 0.85
    },

    // HOSPITAL DOCUMENTS
    {
        pattern: /hospital\s*(record|document|report|notes)/i,
        type: DocumentType.HOSPITAL_DOCUMENT,
        confidence: 1.0
    },
    {
        pattern: /discharge\s*(summary|report|notes)/i,
        type: DocumentType.HOSPITAL_DOCUMENT,
        confidence: 0.95
    },
    {
        pattern: /(admission|inpatient|ward)\s*(notes|record|documentation)/i,
        type: DocumentType.HOSPITAL_DOCUMENT,
        confidence: 0.9
    },
    {
        pattern: /emergency\s*(department|room)\s*(record|notes)/i,
        type: DocumentType.HOSPITAL_DOCUMENT,
        confidence: 0.9
    },
    {
        pattern: /(hospital|medical\s*center)\s*(admission|discharge|transfer)\s*record/i,
        type: DocumentType.HOSPITAL_DOCUMENT,
        confidence: 0.9
    },
    {
        pattern: /(bed|ward|unit)\s*(management|transfer|record)/i,
        type: DocumentType.HOSPITAL_DOCUMENT,
        confidence: 0.85
    },

    // Catch-all patterns with lower confidence
    {
        pattern: /medical|clinical|health/i,
        type: DocumentType.MEDICAL_REPORT,
        confidence: 0.6
    },
    {
        pattern: /notes|observations/i,
        type: DocumentType.CLINICAL_NOTES,
        confidence: 0.5
    },
    {
        pattern: /scan|image|ray/i,
        type: DocumentType.IMAGING_REPORT,
        confidence: 0.5
    }
];


const CONTENT_INDICATORS = {
    hospital: [
        'ward', 'admission', 'discharge', 'inpatient', 'bed', 
        'hospital', 'emergency', 'nurse', 'vital signs'
    ],
    imaging: [
        'xray', 'mri', 'ct scan', 'ultrasound', 'radiograph', 
        'contrast', 'imaging', 'radiology'
    ],
    clinical: [
        'examination', 'symptoms', 'diagnosis', 'treatment',
        'presenting complaint', 'clinical findings'
    ],
    rehab: [
        'physiotherapy', 'rehabilitation', 'exercise', 'therapy',
        'functional assessment', 'mobility'
    ],
    workcover: [
        'injury', 'workplace', 'compensation', 'claim',
        'return to work', 'capacity'
    ],
    allied: [
        'physiotherapist', 'occupational therapist', 'speech pathologist',
        'exercise program', 'therapy goals'
    ]
};

function mapIndicatorToDocumentType(indicator: string): DocumentType {
    const mapping: Record<string, DocumentType> = {
        hospital: DocumentType.HOSPITAL_DOCUMENT,
        imaging: DocumentType.IMAGING_REPORT,
        clinical: DocumentType.CLINICAL_NOTES,
        rehab: DocumentType.REHABILITATION_REPORT,
        workcover: DocumentType.WORKCOVER_CERTIFICATE,
        allied: DocumentType.ALLIED_HEALTH_REPORT
    };

    return mapping[indicator] || DocumentType.UNKNOWN;
}

function matchByContentHeuristics(content: string): TypeMatchResult {
    const contentLower = content.toLowerCase();
    let maxScore = 0;
    let bestMatch = DocumentType.UNKNOWN;
    let matchedTerms: string[] = [];

    for (const [type, terms] of Object.entries(CONTENT_INDICATORS)) {
        const matches = terms.filter(term => contentLower.includes(term));
        const score = matches.length / terms.length;
        
        if (score > maxScore) {
            maxScore = score;
            bestMatch = mapIndicatorToDocumentType(type);
            matchedTerms = matches;
        }
    }

    return {
        type: bestMatch,
        confidence: maxScore,
        matchedTerms
    };
}

export function mapDocumentType(input: string): TypeMatchResult {
    // Handle empty or invalid input
    if (!input?.trim()) {
        return {
            type: DocumentType.UNKNOWN,
            confidence: 0,
            matchedPattern: 'empty input'
        };
    }

    const normalizedInput = input.trim().toUpperCase();

    // Check for exact enum match
    if (Object.values(DocumentType).includes(normalizedInput as DocumentType)) {
        return {
            type: normalizedInput as DocumentType,
            confidence: 1.0,
            matchedPattern: 'exact match'
        };
    }

    // Check pattern mappings
    for (const mapping of DOCUMENT_TYPE_MAPPINGS) {
        if (typeof mapping.pattern === 'string') {
            if (normalizedInput.includes(mapping.pattern.toUpperCase())) {
                return {
                    type: mapping.type,
                    confidence: mapping.confidence,
                    matchedPattern: mapping.pattern
                };
            }
        } else if (mapping.pattern.test(input)) {
            return {
                type: mapping.type,
                confidence: mapping.confidence,
                matchedPattern: mapping.pattern.source
            };
        }
    }

    // Try content-based matching
    const heuristicResult = matchByContentHeuristics(input);
    if (heuristicResult.confidence > 0.5) {
        return heuristicResult;
    }

    // Default to unknown
    return {
        type: DocumentType.UNKNOWN,
        confidence: 0,
        matchedPattern: 'no match found'
    };
}

export function logTypeMapping(input: string, result: TypeMatchResult): void {
    console.log(`Document Type Mapping:
    Input: "${input}"
    Mapped To: ${result.type}
    Confidence: ${result.confidence}
    Pattern: ${result.matchedPattern}
    ${result.matchedTerms ? `Matched Terms: ${result.matchedTerms.join(', ')}` : ''}
    `);
}