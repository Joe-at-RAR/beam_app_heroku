// extraction-schema.ts
import { z } from 'zod';

export const DocumentTypes = {
  // Medical Reports and Specialist Letters
  MEDICAL: "Medical Reports",
  MEDICAL_RECORD: "Medical Records",
  MY_HEALTH_RECORD: "My Health Record",
  GENERAL_PRACTITIONER: "General Practitioner",
  SPECIALIST_LETTER: "Specialist Letters",
  ORTHOPAEDIC_SURGEON: "Orthopaedic Letters",
  PLASTIC_SURGEON: "Plastic Surgeon Letters",
  NEUROSURGEON: "Neurosurgeon Letters",
  PAIN_SPECIALIST: "Pain Specialist Letters",
  PSYCHIATRIST: "Psychiatrist Letters",
  
  // Clinical Documentation
  CLINICAL_NOTES: "Clinical Notes",
  DISCHARGE_SUMMARY: "Discharge Summary",
  SPECIALIST_REFERRAL: "Specialist Referral",
  TREATMENT_PLAN: "Treatment Plans",
  
  // Imaging & Diagnostics
  IMAGING: "Imaging",
  PATHOLOGY: "Pathology",
  
  // Allied Health Reports
  PHYSIOTHERAPY: "Physiotherapy",
  EXERCISE_PHYSIOLOGIST: "Exercise Physiology",
  OCCUPATIONAL_THERAPY: "Occupational Therapy",
  HAND_THERAPY: "Hand Therapy",
  PSYCHOLOGY: "Psychology",
  SPEECH_PATHOLOGY: "Speech Pathology",
  OTHER_ALLIED_HEALTH: "Other Allied Health",
  CONSENT_FORM: "Consent Form",
  
  // Rehabilitation
  REHABILITATION: "Rehabilitation Report",
  FUNCTIONAL_CAPACITY_EVALUATION: "Functional Capacity",
  
  // WorkCover Documentation
  WORKCOVER_FIRST_CERTIFICATE_OF_CAPACITY: "WorkCover First Certificate of Capacity",
  WORKCOVER_PROGRESS_CERTIFICATE: "WorkCover Progress Certificates",
  WORKCOVER_FINAL_CERTIFICATE: "WorkCover Final Certificate",

  
  // Insurance & Legal
  INSURANCE_FORM: "Insurance Form",
  LEGAL_CORRESPONDENCE: "Legal Correspondence",
  MEDICOLEGAL: "Medicolegal Report",
  COURT_DOCUMENTS: "Court Documents",
  EXPERT_WITNESS_STATEMENT: "Expert Witness Statement",
  
  // Assessments
  LIABILITY_ASSESSMENT: "Liability Assessment",
  IMPAIRMENT_ASSESSMENT: "Impairment Assessment",
  PERMANENT_DISABILITY_ASSESSMENT: "Permanent Disability Assessment",
  INDEPENDENT_MEDICAL_EXAMINATION: "Independent Medical Examination",
  PSYCHOLOGICAL_ASSESSMENT: "Psychological Assessment",
  
  // Employment & Incident
  EMPLOYMENT_DOCUMENT: "Employment Document",
  INCIDENT: "Incident Report",
  
  // Hospital & Pharmacy
  HOSPITAL_DOCUMENT: "Hospital Document",
  PHARMACY_RECORDS: "Pharmacy Records",
  
  ADMINISTRATIVE_DOCUMENT: "Administrative Document",
  UNPROCESSED: "Unprocessed",
  UNKNOWN: "Unknown Document Type"
};

// Define key event types for the case timeline
export const KeyEventTypes = {
  // Medical Journey Events
  INJURY: "Injury",
  FIRST_PRESENTATION: "First Presentation",
  SURGERY: "Surgery",
  FIRST_APPOINTMENT: "First Appointment",
  FOLLOW_UP_APPOINTMENT: "Follow-up Appointment",
  FINAL_APPOINTMENT: "Final Appointment",
  
  // Legal and Administrative Events
  LEGAL_NOTICE: "Legal Notice",
  
  // Work Capacity and Assessment Events
  WORKCOVER_FIRST_CERTIFICATE: "First WorkCover Certificate",
  WORKCOVER_PROGRESS_CERTIFICATE: "Progress WorkCover Certificate",
  WORKCOVER_FINAL_CERTIFICATE: "Final WorkCover Certificate",
  ALLIED_HEALTH_CAPACITY_ASSESSMENT: "Allied Health Capacity Assessment",
  
  // Other Significant Events
  OTHER_KEY_EVENT: "Other Key Event"
};


// Key Events array to be added to PageExtractionSchema
const KeyEvents = z.array(z.object({
  date: z.string().nullable().describe("Date of the event in DD/MM/YYYY format"),
  event: z.string().nullable().describe("A brief title for the key event, e.g. 'Surgery', 'Hospital Admission', 'Follow-up Appointment'"),
  description: z.string().nullable().describe("Detailed description of the event"),
  significance: z.string().nullable().describe("Clinical significance of the event to patient care or recovery"),
  documentReference: z.string().nullable().describe("Reference to document containing the event information")
})).nullable();

// IME Question schema to capture structured questions from insurer
const InsurerIMEQuestion = z.object({
  questionNumber: z.number().describe("The numeric identifier of the question (e.g., 1, 2, 3)"),
  questionText: z.string().describe("The full text of the question as asked by the insurer"),
  responseText: z.string().nullable().describe("The response provided in the document, if available"),
}).describe("A structured question from an Independent Medical Examination request");

const insurers = [
  // Current self-insured licensees
  "Amplitel Pty Ptd",
  "Australia and New Zealand Banking Group Limited",
  "Australian Air Express Pty Limited",
  "Australian Capital Territory",
  "Australian National University",
  "Australian Postal Corporation",
  "Bevchain Pty Limited",
  "Bis Industries Limited",
  "Border Express Pty Ltd",
  "BWA Group Services Pty Ltd (Bankwest)",
  "Cleanaway Operations Pty Ltd",
  "Commonwealth Bank of Australia",
  "CSL Limited",
  "DHL Express (Australia) Pty Ltd",
  "DHL Supply Chain (Australia) Pty Ltd",
  "Fedex Express Australia Pty Ltd",
  "Fleetmaster Services Pty Ltd",
  "John Holland Group Pty Ltd",
  "John Holland Pty Ltd",
  "John Holland Rail Pty Ltd",
  "K&S Freighters Pty Limited",
  "Linfox Armaguard Pty Ltd",
  "Linfox Australia Pty Ltd",
  "Medibank Private Limited",
  "National Australia Bank Limited",
  "Optus Administration Pty Limited",
  "Pacific National Services Pty Ltd",
  "Prosegur Australia Pty Limited",
  "Ramsay Health Care Australia Pty Limited",
  "Reserve Bank of Australia",
  "Ron Finemore Transport Services Pty Limited",
  "StarTrack Express Pty Ltd",
  "StarTrack Retail Pty Ltd",
  "Telstra Corporation Limited",
  "Telstra Limited",
  "Thales Australia Limited",
  "Virgin Australia Airlines Pty Ltd",
  "Visionstream Pty Ltd",
  "Wilson Parking Australia 1992 Pty Ltd",
  "Wilson Security Pty Ltd",
  // Former self-insured licensees
  "Avanteos Pty Ltd",
  "Colonial Services Pty Limited",
  "Hollard Insurance Partners Limited",
  "Commonwealth Securities Limited",
  "JRH Biosciences Pty Ltd",
  "Medibank Health Solutions Pty Ltd",
  "MLC Wealth Limited",
  "Network Design and Construction Limited",
  "Vicinity Centres PM Pty Ltd"
];

// Personal Identifiers – all values are extracted as plain text.

// Contact Information – generic contact details (if not otherwise captured by claimant or author).
const ContactInformation = z.array(z.object({
  title: z.string().nullable().describe("Title (e.g., Mr, Mrs, Dr) as printed."),
  firstName: z.string().nullable().describe("First name as printed, letter-for-letter."),
  familyName: z.string().nullable().describe("Family (last) name as printed, letter-for-letter."),
  profession: z.string().nullable().describe("Profession or job title as printed. Must match one of the approved options exactly or be 'Unknown'."),
  role: z.string().nullable().describe("Role in relation to the patient/case (e.g., 'Treating Doctor', 'Case Manager', 'Employer Representative')."),
  contactNumbers: z.array(z.object({
    type: z.string().describe("Type of number (e.g., 'Mobile', 'Work', 'Fax')"),
    number: z.string().describe("Contact number with any formatting")
  })).nullable(),
  practiceName: z.string().nullable().describe("Name of the practice or organization, preserving formatting."),
  address: z.string().nullable().describe("Address in standard mailing format (street, city, ZIP, etc.) as printed."),
  email: z.string().nullable().describe("Email address in standard format (e.g., example@example.com)."),
  relationshipToPatient: z.string().nullable().describe("Relationship to the patient if specified (e.g., 'Treating Doctor', 'Family Member', 'Case Manager')."),
  dateOfContact: z.string().nullable().describe("Date of contact/interaction if mentioned in DD/MM/YYYY format."),
  personIsAuthorOfDocument: z.boolean().nullable().describe("Whether the person is the author of the document.")
})).nullable().describe("Array of contact information for all people mentioned in the document.");

// Diagnosis Items
const DiagnosisItem = z.object({
  condition: z.string().nullable().describe("Diagnosis condition text exactly as recorded."),
  date: z.string().nullable().describe("Diagnosis date in DD/MM/YYYY format."),
  status: z.string().nullable().describe("Diagnosis status as printed."),
  diagnosedBy: z.string().nullable().describe("Name and role of diagnosing practitioner."),
  category: z.string().nullable().describe("Category of diagnosis (e.g., 'Primary', 'Secondary', 'Complication')."),
  severity: z.string().nullable().describe("Severity as documented."),
  evidence: z.string().nullable().describe("Evidence supporting diagnosis."),
  impactOnFunction: z.string().nullable().describe("Documented impact on function/daily activities."),
  relationToInjury: z.string().nullable().describe("Relationship to claimed injury if specified."),
  notes: z.string().nullable().describe("Additional diagnostic notes.")
}).nullable();

// Treatment Items
const TreatmentItem = z.object({
  treatment: z.string().nullable().describe("Treatment description as mentioned."),
  date: z.string().nullable().describe("Treatment date in DD/MM/YYYY format."),
  provider: z.string().nullable().describe("Name of the provider or facility."),
  type: z.string().nullable().describe("Type of treatment (e.g., 'Conservative', 'Surgical', 'Therapy')."),
  duration: z.string().nullable().describe("Duration of treatment as documented. Do not include if not present."),
  frequency: z.string().nullable().describe("Frequency of treatment sessions.  Do not include if not present."),
  compliance: z.string().nullable().describe("Patient compliance notes if mentioned. Do not include if not present."),
  outcome: z.string().nullable().describe("Outcome of the treatment. Do not include if not present."),
  sideEffects: z.string().nullable().describe("Any documented side effects. Do not include if not present."),
  cost: z.string().nullable().describe("Cost information if mentioned. Do not include if not present."),
  goals: z.string().nullable().describe("Treatment goals as documented. Do not include if not present."),
  progress: z.string().nullable().describe("Progress notes related to treatment. Do not include if not present."),
  complications: z.string().nullable().describe("Any complications noted. Do not include if not present."),
  followUpPlan: z.string().nullable().describe("Follow-up plan details. Do not include if not present.")
}).nullable();

// Medication Items - Enhanced with temporal and status information
const MedicationItem = z.object({
  name: z.string().nullable().describe("Medication name exactly as printed."),
  dosage: z.string().nullable().describe("Dosage information (e.g., '500 mg')."),
  frequency: z.string().nullable().describe("Frequency details (e.g., 'twice daily')."),
  route: z.string().nullable().describe("Route of administration as printed (e.g., 'oral', 'intramuscular')."),
  startDate: z.string().nullable().describe("Start date in DD/MM/YYYY format."),
  endDate: z.string().nullable().describe("End date in DD/MM/YYYY format if medication was ceased."),
  status: z.string().nullable().describe("Status as printed (e.g., 'Active', 'Ceased', 'On Hold')."),
  prescribedBy: z.string().nullable().describe("Name of prescribing doctor as printed."),
  reasonForCessation: z.string().nullable().describe("Reason medication was stopped, if applicable."),
  sideEffects: z.string().nullable().describe("Any documented side effects."),
  effectiveness: z.string().nullable().describe("Noted effectiveness or response to medication."),
  instructions: z.string().nullable().describe("Special instructions or notes about administration."),
  supply: z.string().nullable().describe("Supply details (e.g., 'PBS', 'Private') as printed."),
  repeats: z.string().nullable().describe("Number of repeats as text (e.g., '3 repeats').")
}).nullable();

// Allergy Items
const AllergyItem = z.object({
  allergen: z.string().nullable().describe("Name of allergen exactly as printed."),
  reaction: z.string().nullable().describe("Description of allergic reaction as documented."),
  severity: z.string().nullable().describe("Severity as documented (e.g., 'mild', 'severe')."),
  dateIdentified: z.string().nullable().describe("Date allergy was identified in DD/MM/YYYY format."),
  status: z.string().nullable().describe("Current status of allergy as printed (e.g., 'Active', 'Resolved')."),
  source: z.string().nullable().describe("Source of allergy information (e.g., 'Patient reported', 'Confirmed')."),
  notes: z.string().nullable().describe("Additional notes about the allergy.")
}).nullable();

// Update ClinicalContent to include allergies
const ClinicalContent = z.object({
  diagnosis: z.array(DiagnosisItem).nullable().describe("List of diagnosis entries extracted from the document."),
  treatments: z.array(TreatmentItem).nullable().describe("List of treatment entries including dates and outcomes."),
  medications: z.array(MedicationItem).nullable().describe("List of medications with comprehensive details."),
  allergies: z.array(AllergyItem).nullable().describe("List of allergies and adverse reactions.")
}).nullable();

const WorkCapacityRestriction = z.object({
  restriction: z.string().describe("Specific work restriction as stated"),
  startDate: z.string().nullable().describe("Start date of restriction in DD/MM/YYYY format"),
  toDate: z.string().nullable().describe("End date of restriction in DD/MM/YYYY format"),
  duration: z.string().nullable().describe("Duration as stated (e.g., '2 weeks', '3 months', 'permanent')")
});

const WorkCapacityModification = z.object({
  modification: z.string().describe("Specific workplace modification required"),
  startDate: z.string().nullable().describe("Start date of modification in DD/MM/YYYY format"),
  toDate: z.string().nullable().describe("End date of modification in DD/MM/YYYY format"),
  duration: z.string().nullable().describe("Duration as stated (e.g., '2 weeks', '3 months', 'permanent')")
});

const WorkCapacity = z.object({
  status: z.string().nullable().describe("Work capacity status as printed"),
  hours: z.string().nullable().describe("Work hours per week as text value"),
  restrictions: z.array(WorkCapacityRestriction).nullable().describe("List of specific work restrictions"),
  modifications: z.array(WorkCapacityModification).nullable().describe("List of required workplace modifications"),
  reviewDate: z.string().nullable().describe("Work capacity review date in DD/MM/YYYY format"),
  certifiedFrom: z.string().nullable().describe("Start date of certification period"),
  certifiedTo: z.string().nullable().describe("End date of certification period"),
  upgradeSchedule: z.string().nullable().describe("Planned schedule for upgrading hours/duties")
}).nullable();

// Employment
const Employment = z.object({
  occupation: z.string().nullable().describe("Job title or occupation as stated; must match approved options exactly or be 'Unknown'."),
  employerName: z.string().nullable().describe("Employer name as printed."),
  employerAddress: z.string().nullable().describe("Employer address in standard mailing format, preserving formatting."),
  employerPhoneNumber: z.string().nullable().describe("Employer phone number as printed."),
  employmentStatus: z.string().nullable().describe("Employment status (must be one of: ACTIVE, SUSPENDED, TERMINATED, RESIGNED)"),
  preInjuryHours: z.string().nullable().describe("Pre-injury hours per week"),
  preInjuryDays: z.string().nullable().describe("Pre-injury days per week"),
  duties: z.array(z.string()).nullable().describe("List of job duties or responsibilities"),
  employmentStartDate: z.string().nullable().describe("Employment start date in DD/MM/YYYY format."),
  employmentEndDate: z.string().nullable().describe("Employment end date in DD/MM/YYYY format, if applicable.")
}).nullable();

// Injury
const Injury = z.object({
  dateOfInjury: z.string().nullable().describe("Injury date in DD/MM/YYYY format."),
  timeOfInjury: z.string().nullable().describe("Time of injury if specified."),
  mechanism: z.string().nullable().describe("Mechanism of injury as described."),
  location: z.string().nullable().describe("Physical location where injury occurred."),
  activity: z.string().nullable().describe("Activity being performed when injured."),
  affectedArea: z.string().nullable().describe("Location on body, include laterality if known."),
  severity: z.string().nullable().describe("Initial severity assessment."),
  initialTreatment: z.string().nullable().describe("Initial treatment provided."),
  initialPresentation: z.string().nullable().describe("Where/when first sought treatment."),
  reportedDate: z.string().nullable().describe("Date reported in DD/MM/YYYY format."),
  reportedTo: z.string().nullable().describe("Person/entity injury reported to."),
  witnesses: z.string().nullable().describe("Details of any witnesses."),
  preExistingConditions: z.string().nullable().describe("Relevant pre-existing conditions."),
  aggravatingFactors: z.string().nullable().describe("Noted aggravating factors."),
  alleviatingFactors: z.string().nullable().describe("Noted alleviating factors."),
  impactOnFunction: z.string().nullable().describe("Impact on activities of daily living."),
  progressNotes: z.string().nullable().describe("Notes on injury progress.")
}).nullable();

// Procedure Items – flat structure.
const ProcedureItem = z.object({
  name: z.string().nullable().describe("Procedure name exactly as printed."),
  date: z.string().nullable().describe("Procedure date in DD/MM/YYYY format."),
  practitioner: z.string().nullable().describe("Name of the practitioner performing the procedure."),
  organisation: z.string().nullable().describe("Organisation responsible for the procedure, as printed."),
  outcome: z.string().nullable().describe("Procedure outcome or result exactly as recorded."),
  notes: z.string().nullable().describe("Additional notes regarding the procedure.")
});

// Imaging
const Imaging = z.object({
  bodyPart: z.string().nullable().describe("Body part that has been imaged, exactly as printed."),
  date: z.string().nullable().describe("Imaging date in DD/MM/YYYY format."),
  technique: z.string().nullable().describe("Technique used during imaging (e.g., MRI, X-Ray, CT)."),
  provider: z.string().nullable().describe("Imaging provider or facility."),
  requestedBy: z.string().nullable().describe("Name of requesting practitioner."),
  reportedBy: z.string().nullable().describe("Name of reporting radiologist/specialist."),
  clinicalNotes: z.string().nullable().describe("Clinical notes provided on request."),
  findings: z.string().nullable().describe("Detailed findings from imaging."),
  conclusion: z.string().nullable().describe("Conclusion of the imaging report."),
  comparison: z.string().nullable().describe("Comparison with previous imaging if mentioned."),
  recommendedFollowUp: z.string().nullable().describe("Recommended follow-up imaging if any.")
}).nullable();

// Recommendations
const Recommendations = z.object({
  investigations: z.array(z.object({
    investigation: z.string().describe("Specific investigation recommended"),
    timeframe: z.string().nullable().describe("Recommended timeframe for investigation"),
    reason: z.string().nullable().describe("Reason for investigation")
  })).nullable().describe("List of recommended investigations"),
  
  referrals: z.array(z.object({
    specialist: z.string().describe("Type of specialist for referral"),
    urgency: z.string().nullable().describe("Urgency of referral if specified"),
    reason: z.string().nullable().describe("Reason for referral")
  })).nullable().describe("List of recommended referrals"),
  
  reviewDate: z.string().nullable().describe("Review date in DD/MM/YYYY format")
}).nullable();

// Conclusions
const Conclusions = z.object({
  diagnosisConclusions: z.string().nullable().describe("Conclusions regarding the diagnosis exactly as stated."),
  causation: z.string().nullable().describe("Details about causation as described in the document."),
  prognosis: z.string().nullable().describe("Prognosis exactly as printed."),
  treatmentRecommendations: z.string().nullable().describe("Final treatment recommendations from the document conclusions.")
}).nullable();

// Insurer – Updated to include additional details.
const InsuranceDetails = z.object({
  insurerName: z.string().nullable().describe(
    `Insurer - If known use one of the following (${insurers.join(', ')}). Do not make up an insurer name.`
  ),
  insurerRepresentative: z.string().nullable().describe(
    "Name of the person within the company who handles the case, as printed. Must be returned letter-for-letter."
  ),
  insurerPhone: z.string().nullable().describe(
    "Phone number of the insurer's representative or claims department, preserving any formatting."
  ),
  insurerEmail: z.string().nullable().describe(
    "Email address of the insurer's representative or claims department in standard format (e.g., example@example.com)."
  ),
  claimNumber: z.string().nullable().describe(
    "Claim number as it appears in the document."
  ),
  insurancePolicyNumber: z.string().nullable().describe(
    "Insurance policy number exactly as printed."
  )
}).nullable();

// Claimant – patient details
const Patient = z.object({
  title: z.string().nullable().describe("Claimant title (e.g., Mr, Mrs, Dr) as printed."),
  firstName: z.string().nullable().describe("Claimant's first name as printed, letter-for-letter."),
  familyName: z.string().nullable().describe("Claimant's family name as printed, letter-for-letter."),
  dateOfBirth: z.string().nullable().describe("Patient's date of birth in DD/MM/YYYY format."),
  gender: z.string().nullable().describe("Patient's gender. Must be 'Male', 'Female', 'Other', or 'Unknown', matching letter-for-letter."),
  occupation: z.string().nullable().describe("Patient's occupation"),
  contactNumber: z.string().nullable().describe("Contact number with formatting preserved."),
  address: z.string().nullable().describe("Claimant address exactly as printed."),
  email: z.string().nullable().describe("Email address in standard format (e.g., example@example.com)."),
  medicareNumber: z.string().nullable().describe("Medicare number: 10 digits, formatted as 9 digits with a check digit (e.g. 1234 56789 0)"),
  required: z.array(z.string()).nullable().describe("List of required fields that are missing from the document."),
  isCorrectPatientInContext: z.boolean().nullable().describe("AI Judgment: Compare extracted patient name and DOB against the patientContext provided in the prompt. Set to 'true' if confident they match, 'false' if confident they DO NOT match, and 'null' if unsure or no context was given."),
}).nullable()
  // Add a title for Azure OpenAI compatibility
  .describe("Patient information");

export type PageExtraction = z.infer<typeof PageExtractionSchema>;

const specialists = [
  "Addiction Medicine Specialist",
  "Allergy Specialist & Immunologist",
  "Anaesthetist",
  "Bariatric Surgeon",
  "Breast Surgeon",
  "Cardiologist",
  "Cardiothoracic Surgeon",
  "Chiropractor",
  "Clinical Geneticist",
  "Clinical Pharmacologist",
  "Clinical Psychologist",
  "Colorectal Surgeon",
  "Counsellor",
  "Dentist",
  "Dermatologist",
  "Diabetes Educator",
  "Dietitian",
  "Ear Nose and Throat Surgeon",
  "Emergency Medicine Physician",
  "Endocrinologist",
  "Exercise Physiologist",
  "Gastroenterologist",
  "General Surgeon",
  "Geriatrician",
  "GP",
  "Haematologist",
  "Hand Surgeon",
  "Infectious Diseases Specialist",
  "Intensive Care Specialist",
  "Massage Therapist",
  "Medical Oncologist",
  "Nephrologist",
  "Neurologist",
  "Neurosurgeon",
  "Nuclear Medicine Physician",
  "Nutritionist",
  "Occupational Therapist",
  "Ophthalmologist",
  "Optometrist",
  "Orthopaedic Surgeon",
  "Osteopath",
  "Paediatrician",
  "Pain Medicine Specialist",
  "Pathologist",
  "Pharmacist",
  "Physiotherapist",
  "Plastic Surgeon",
  "Psychiatrist",
  "Psychologist",
  "Radiation Oncologist",
  "Radiologist",
  "Registered Nurse",
  "Rehabilitation Specialist",
  "Respiratory & Sleep Medicine Specialist",
  "Rheumatologist",
  "Social Worker",
  "Speech Pathologist",
  "Sport and Exercise Physician",
  "Upper GI Surgeon",
  "Urologist",
  "Vascular Surgeon"
];

// Author – provider details
const Author = z.object({
  firstName: z.string().nullable().describe("Provider's first name as printed, letter-for-letter."),
  familyName: z.string().nullable().describe("Provider's family name as printed, letter-for-letter."),
  providerRole: z.string().nullable().describe(`Provider's role. Must be a letter-for-letter match to one of the approved titles (${specialists.join(', ')}) or be 'Unknown'.`),
  providerOrganization: z.string().nullable().describe("Name of the provider's organization or hospital as printed."),
  contactDetails: z.string().nullable().describe("Provider's contact details including phone number and/or email, preserving original formatting.")
}).nullable();

// Main Page Extraction Schema – holds both metadata and extracted content sections.
// Note: positional information (page number, dimensions) is omitted and will be enriched separately.
export const PageExtractionSchema = z.object({
  category: z.string().nullable().describe(`[STRICT!] Document category from a standard set (e.g., ${Object.keys(DocumentTypes).join(', ')}, etc.). THIS IS HIGHLY STRICT THAT YOU STICK TO THESE DOCUMENT TYPES. Preference a category which is more general if it is not clear what the document type is, BUT STILL CHOOSE ONE FROM THE LIST AND DO NOT INVENT THEM.`),
  documentTitle: z.string().nullable().describe("A concise title summarizing the document (typically 2–4 words)."),
  documentDate: z.string().nullable().describe("Document date in DD/MM/YYYY format, if available."),
  patient: Patient.nullable(),
  contactInformation: ContactInformation.nullable(),
  clinicalContent: ClinicalContent.nullable(),
  workCapacity: WorkCapacity.nullable(),
  employment: Employment.nullable(),
  injury: Injury.nullable(),
  procedure: z.array(ProcedureItem).nullable().describe("A list of procedure entries extracted from the document."),
  imaging: Imaging.nullable(),
  recommendations: Recommendations.nullable(),
  author: Author.nullable(),
  conclusions: Conclusions.nullable(),
  insurer: InsuranceDetails.nullable(),
  incorrectPatient: z.boolean().nullable().describe("True if the patient details on the document are vastly different to any information you have been provided details."),
  keyEvents: KeyEvents.nullable(),
  insurerRequestForIME: z.object({
    referenceNumber: z.string().nullable().describe("The reference number assigned by the insurer to this IME request"),
    addressedTo: z.string().nullable().describe("The medicolegal company or provider this IME request is addressed to"),
    questions: z.array(InsurerIMEQuestion).describe("The numbered questions included in the IME request document")
  }).nullable().describe("A document from an insurer requesting an Independent Medical Examination (IME), containing numbered questions that need responses. This should ONLY be identified for documents that are explicitly addressed to a medicolegal company, requesting an IME, and containing a structured set of numbered questions."),
  patientConsentForInsurerRelease: z.object({
    patientSigned: z.boolean().describe("Whether the patient has signed the consent form"),
    patientSignedOnDate: z.string().nullable().describe("The date when the patient signed the consent form (DD/MM/YYYY format)")
  }).nullable().describe("A document where the patient explicitly consents for the insurer to release their information to a medicolegal company. ONLY mark documents as this type if they contain explicit patient consent language and signature for information release."),
}).describe("Unified Extraction Schema for document content, excluding positional data which will be enriched separately.");

// New split schemas to handle parameter limits - Now in four parts

// Part 1: Document Metadata and Patient Information
export const PageExtractionSchemaPart1 = z.object({
  category: z.string().nullable().describe(`[STRICT!] Document category from a standard set (e.g., ${Object.keys(DocumentTypes).join(', ')}, etc.). Preference a category which is more general if it is not highly explicity clear what the document type is.`),
  documentTitle: z.string().nullable().describe("A concise title summarizing the document (typically 2–4 words)."),
  documentDate: z.string().nullable().describe("Document date in DD/MM/YYYY format, if available."),
  patient: Patient.nullable().describe("Patient information"),
  author: Author.nullable().describe("Author information"),
  incorrectPatient: z.boolean().nullable().describe("True if the patient details on the document are vastly different to any information you have been provided details."),
}).describe("Part 1: Basic document metadata and patient identification");

// Part 2: Clinical Content (moved to separate part to reduce parameter count)
export const PageExtractionSchemaPart2 = z.object({
  clinicalContent: ClinicalContent.nullable().describe("Clinical information including diagnoses, treatments, medications, and allergies"),
}).describe("Part 2: Clinical information including diagnoses, treatments, medications, and allergies");

// Part 3: Work Capacity, Employment and Injury Information
export const PageExtractionSchemaPart3 = z.object({
  workCapacity: WorkCapacity.nullable().describe("Work capacity information"),
  employment: Employment.nullable().describe("Employment information"),
  injury: Injury.nullable().describe("Injury information"),
  insurer: InsuranceDetails.nullable().describe("Insurance details"),
  insurerRequestForIME: z.object({
    referenceNumber: z.string().nullable().describe("The reference number assigned by the insurer to this IME request"),
    addressedTo: z.string().nullable().describe("The medicolegal company or provider this IME request is addressed to"),
    questions: z.array(InsurerIMEQuestion).describe("The numbered questions included in the IME request document")
  }).nullable().optional().describe("ONLY populate if document is explicitly an IME request with numbered questions..."),
  patientConsentForInsurerRelease: z.object({
    patientSigned: z.boolean().describe("Whether the patient has signed the consent form"),
    patientSignedOnDate: z.string().nullable().describe("The date when the patient signed the consent form (DD/MM/YYYY format)")
  }).nullable().optional().describe("ONLY populate if document contains explicit patient consent signature for release..."),
}).describe("Part 3: Work capacity, employment and injury details");

// Part 4: Procedures, Recommendations and Events
export const PageExtractionSchemaPart4 = z.object({
  procedure: z.array(ProcedureItem).nullable().describe("A list of procedure entries extracted from the document."),
  imaging: Imaging.nullable().describe("Imaging information"),
  recommendations: Recommendations.nullable().describe("Recommendations for investigations and referrals"),
  conclusions: Conclusions.nullable().describe("Conclusions regarding the diagnosis, causation, prognosis, and treatment recommendations"),
  contactInformation: ContactInformation.nullable().describe("Contact information for the insurer"),
  keyEvents: KeyEvents.nullable().describe("Key events and milestones in the patient's medical journey"),
}).describe("Part 4: Procedures, imaging, recommendations and key events");

// Add utility function to combine extraction parts
export function combineExtractionParts(part1: any, part2: any, part3?: any, part4?: any): any {
  // Combine the parts
  const combined = {
    ...part1,
    ...part2,
    ...(part3 || {}),
    ...(part4 || {})
  };
  
  // Initialize author with all required fields
  if (!combined.author) {
    combined.author = {};
  }

  // Ensure all author fields exist with default values
  const authorFields = ['firstName', 'familyName', 'providerRole', 'providerOrganization', 'contactDetails'];
  authorFields.forEach(field => {
    if (combined.author[field] === undefined) {
      combined.author[field] = null;
    }
  });
  
  // Initialize patient with all required fields
  if (!combined.patient) {
    combined.patient = {};
  }
  
  // Ensure all required patient fields exist with default values
  const patientFields = [
    'title', 'firstName', 'familyName', 'dateOfBirth', 'gender', 'occupation',
    'contactNumber', 'address', 'email', 'medicareNumber',
    'isCorrectPatientInContext'
  ];
  
  patientFields.forEach(field => {
    if (combined.patient[field] === undefined) {
      combined.patient[field] = null;
    }
  });
  
  // Ensure patient.required exists and is an array
  if (!combined.patient.required) {
    combined.patient.required = [];
  }
  
  // Initialize all top-level required objects
  const requiredObjects = [
    'contactInformation', 'clinicalContent', 'workCapacity',
    'employment', 'injury', 'imaging', 'recommendations', 'conclusions',
    'insurer', 'keyEvents', 'insurerRequestForIME', 'patientConsentForInsurerRelease'
  ];
  
  requiredObjects.forEach(field => {
    if (combined[field] === undefined) {
      if (field === 'procedure' || field === 'keyEvents' || field === 'contactInformation') {
        // These should be arrays
        combined[field] = [];
      } else {
        // These should be objects
        combined[field] = {};
      }
    }
  });
  
  // Initialize clinical content structure deeply
  if (!combined.clinicalContent) {
    combined.clinicalContent = {};
  }
  
  // Ensure diagnosis array exists and all diagnosis items have required fields
  if (!combined.clinicalContent.diagnosis) {
    combined.clinicalContent.diagnosis = [];
  } else if (Array.isArray(combined.clinicalContent.diagnosis)) {
    // Process each diagnosis item to ensure all required fields exist
    const diagnosisFields = [
      'condition', 'date', 'status', 'diagnosedBy', 'category', 
      'severity', 'evidence', 'impactOnFunction', 'relationToInjury', 'notes'
    ];
    
    combined.clinicalContent.diagnosis.forEach((diagnosis: any, index: number) => {
      if (diagnosis) {
        diagnosisFields.forEach(field => {
          if (diagnosis[field] === undefined) {
            diagnosis[field] = null;
          }
        });
      } else {
        // If the item is null or undefined, replace with a properly initialized object
        combined.clinicalContent.diagnosis[index] = diagnosisFields.reduce((obj: any, field) => {
          obj[field] = null;
          return obj;
        }, {});
      }
    });
  }
  
  // Ensure treatments array exists and is properly initialized
  if (!combined.clinicalContent.treatments) {
    combined.clinicalContent.treatments = [];
  } else if (Array.isArray(combined.clinicalContent.treatments)) {
    // Process each treatment item
    const treatmentFields = [
      'treatment', 'date', 'provider', 'type', 'duration', 'frequency',
      'compliance', 'outcome', 'sideEffects', 'cost', 'goals',
      'progress', 'complications', 'followUpPlan'
    ];
    
    combined.clinicalContent.treatments.forEach((treatment: any, index: number) => {
      if (treatment) {
        treatmentFields.forEach(field => {
          if (treatment[field] === undefined) {
            treatment[field] = null;
          }
        });
      } else {
        combined.clinicalContent.treatments[index] = treatmentFields.reduce((obj: any, field) => {
          obj[field] = null;
          return obj;
        }, {});
      }
    });
  }
  
  // Ensure medications array exists and is properly initialized
  if (!combined.clinicalContent.medications) {
    combined.clinicalContent.medications = [];
  } else if (Array.isArray(combined.clinicalContent.medications)) {
    // Process each medication item
    const medicationFields = [
      'name', 'dosage', 'frequency', 'route', 'startDate', 'endDate',
      'status', 'prescribedBy', 'reasonForCessation', 'sideEffects',
      'effectiveness', 'instructions', 'supply', 'repeats'
    ];
    
    combined.clinicalContent.medications.forEach((medication: any, index: number) => {
      if (medication) {
        medicationFields.forEach(field => {
          if (medication[field] === undefined) {
            medication[field] = null;
          }
        });
      } else {
        combined.clinicalContent.medications[index] = medicationFields.reduce((obj: any, field) => {
          obj[field] = null;
          return obj;
        }, {});
      }
    });
  }
  
  // Ensure allergies array exists and is properly initialized
  if (!combined.clinicalContent.allergies) {
    combined.clinicalContent.allergies = [];
  } else if (Array.isArray(combined.clinicalContent.allergies)) {
    // Process each allergy item
    const allergyFields = [
      'allergen', 'reaction', 'severity', 'dateIdentified', 
      'status', 'source', 'notes'
    ];
    
    combined.clinicalContent.allergies.forEach((allergy: any, index: number) => {
      if (allergy) {
        allergyFields.forEach(field => {
          if (allergy[field] === undefined) {
            allergy[field] = null;
          }
        });
      } else {
        combined.clinicalContent.allergies[index] = allergyFields.reduce((obj: any, field) => {
          obj[field] = null;
          return obj;
        }, {});
      }
    });
  }
  
  // Validate against the full schema
  const result = PageExtractionSchema.safeParse(combined);
  if (!result.success) {
    console.log('Combined extraction validation error:', result.error);
    
    // Handle validation errors by fixing the issues
    try {
      const issues = result.error.issues || [];
      for (const issue of issues) {
        if (issue.code === 'invalid_type') {
          let current = combined;
          let path = [...issue.path];
          
          // Navigate to the parent object
          while (path.length > 1) {
            const segment = path.shift() as string | number;
            if (current[segment] === undefined) {
              // Create missing parent object or array
              if (typeof path[0] === 'number') {
                current[segment] = [];
              } else {
                current[segment] = {};
              }
            }
            current = current[segment];
          }
          
          // Set the value based on expected type
          const lastSegment = path[0];
          if (issue.expected === 'string') {
            current[lastSegment] = null;
          } else if (issue.expected === 'array') {
            current[lastSegment] = [];
          } else if (issue.expected === 'object') {
            current[lastSegment] = {};
          } else if (issue.expected === 'boolean') {
            current[lastSegment] = false;
          } else if (issue.expected === 'number') {
            current[lastSegment] = null;
          }
        }
      }
      
      // Attempt validation one more time after fixes
      const retryResult = PageExtractionSchema.safeParse(combined);
      if (retryResult.success) {
        console.log('Validation succeeded after fixing issues');
        return retryResult.data;
      }
    } catch (e) {
      console.log('Error fixing validation issues:', e);
    }
    
    // Still return the fixed combined object even if validation fails
    return combined;
  }
  
  return result.data;
}
