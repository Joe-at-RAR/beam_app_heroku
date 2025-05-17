// shared/query-mappings.ts
// Defines the mappings between user-facing queries and server-side enhanced prompts

/**
 * Interface for a predefined query with both client and server representations
 */
export interface PredefinedQuery {
    id: string                 // Unique identifier for the query
    category: string           // Category for grouping related queries
    summary: string            // Short summary text shown to users
    fullQuery: string          // Full query as shown to and sent by clients
    enhancedPrompt: string     // Expanded server-side prompt with detailed instructions
  }
  
  /**
   * Complete list of predefined queries with their enhanced server-side prompts
   */
  export const PREDEFINED_QUERIES: PredefinedQuery[] = [
    // Clinical Opinion Analysis
    {
      id: 'opinion-consensus',
      category: 'clinical-opinions',
      summary: 'Provider opinion consensus',
      fullQuery: 'What were the final opinions of all health professionals who saw the patient? Group them by diagnosis/opinion.',
      enhancedPrompt: `Extract the final clinical opinions from all healthcare providers who assessed the patient. Group providers by their diagnostic conclusions to identify consensus and divergent opinions.
  
  FORMAT YOUR RESPONSE AS FOLLOWS:
  1. Begin with a brief overview stating the total number of providers who offered opinions and whether there is general consensus or significant disagreement.
  2. Create distinct sections for each major diagnostic conclusion.
  3. For each diagnostic grouping, create a table with these exact columns:
     | Provider | Specialty | Date | Diagnosis | Key Quote | Citation |
  
  SPECIFIC REQUIREMENTS:
  - Include ONLY the most recent opinion from each provider if their assessment evolved over time
  - Direct quotes must be verbatim with quotation marks
  - All dates must be in DD/MM/YYYY format
  - For "Provider" column, include only the provider's name without their title
  - For "Specialty" column, include only their medical specialty, use shorthand where appropriate e.g. Ortho, Plastics, Psychology, Psychiatry, GP, Physio, Exercise Physiologist, Occupational Therapist (so shortened only where posisble while retaining clarity)
  - For "Diagnosis" column, include a concise 2-5 word diagnostic label
  - For "Key Quote" column, include a verbatim quote (max 25 words) with the provider's opinion
  - For "Citation" column, use ONLY the citation number in the standard citation format from the vector store, not document titles or filenames
  - For each diagnostic grouping, after the table, provide 1-2 sentences summarizing the common elements of these providers' reasoning
  - If a provider offered multiple distinct diagnoses, include them in each relevant diagnostic group
  - Pay particular attention to opinions regarding causation related to the workplace incident/MVA
  - Include only formal opinions from qualified healthcare providers, not administrative notes
  
  This information is critically important for understanding the weight of medical evidence under the Workers' Compensation and Injury Management Act 1981 (WA) or Motor Vehicle (Third Party Insurance) Act 1943 (WA) frameworks.

YOUR MOST CRITICAL INSTRUCTION - EVERYTHING MUST HAVE CITATIONS TO THE DOCUMENTS YOU RETRIEVE FROM THE VECTOR STORE`
    },
    {
      id: 'opinion-changes',
      category: 'clinical-opinions',
      summary: 'Changed provider opinions',
      fullQuery: 'Which healthcare providers changed their diagnosis, opinion, or recommendations over time? Explain the evolution of their opinions with relevant dates.',
      enhancedPrompt: `Identify and analyze instances where healthcare providers significantly changed their diagnoses, opinions, or recommendations regarding the patient's condition over time.

FORMAT YOUR RESPONSE AS FOLLOWS:
1. Begin with a brief summary stating how many providers had notable changes in their opinions.
2. For each provider who modified their assessment, create a table with these exact columns:
   | Provider | Specialty | Date | Original Opinion | Date | Revised Opinion | Citation |

SPECIFIC REQUIREMENTS:
- Never make generic statements, only ones specific to this patients case. For instance the doctor reading this has substantial clinical knowledge to support their understanding and it is unhelpful to make basic statements about meaning which they easily know in their context..
- Ensure that there is longer length given to columns which would necessitate it. For instance for Name, it is typical that a name is longer than just 4 characters so this should give apporpriate space. 
- All dates must be in DD/MM/YYYY format
- For "Provider" column, include only the provider's name without their title
- For "Specialty" column, include only their medical specialty, use shorthand where appropriate e.g. Ortho, Plastics, Psychology, Psychiatry, GP, Physio, Exercise Physiologist, Occupational Therapist (so shortened only where posisble while retaining clarity)
- Organize the table chronologically by provider and date
- For "Original Opinion" and "Revised Opinion" columns, use concise descriptions (10-20 words)
- For "Citation" column, use ONLY the citation number in the standard citation format from the vector store, not document titles or filenames
- After each provider's table, include 1-2 paragraphs analyzing:
  * The specific nature of the change (diagnosis, treatment recommendations, causation opinion, etc.)
  * Any explicitly stated reasons for the change (new test results, response to treatment, etc.)
  * Whether the change represents a complete reversal or a refinement of the original opinion
- Pay particular attention to changes in opinions regarding:
  * Causation related to the workplace incident/MVA
  * Work capacity and restrictions
  * Treatment recommendations
  * Permanent impairment assessments

These opinion evolution patterns are significant for evaluating medical evidence under relevant compensation frameworks.

YOUR MOST CRITICAL INSTRUCTION - EVERYTHING MUST HAVE CITATIONS TO THE DOCUMENTS YOU RETRIEVE FROM THE VECTOR STORE`
    },
    {
      id: 'expert-disagreements',
      category: 'clinical-opinions',
      summary: 'Provider opinion conflicts',
      fullQuery: 'Are there conflicting medical opinions regarding the nature or extent of the injury?',
      enhancedPrompt: `Identify and analyze significant conflicts in professional opinions regarding diagnosis, causation, treatment approach, or prognosis. Focus on disagreements that could impact claim determination.

FORMAT YOUR RESPONSE AS FOLLOWS:
1. Begin with a brief summary of the main areas of clinical disagreement.
2. For each disputed issue, create a section with:
   A. A precise statement of the disputed issue (e.g., "Nature of Spinal Pathology" or "Causative Relationship to Workplace Incident")
   B. A table with these exact columns:
      | Position A | Advocates (Provider) | Specialty | Date | Key Support For Position A | Position B | Advocates (Provider) | Specialty | Date | Key Support For Position B | Citation |

SPECIFIC REQUIREMENTS:
- Never make generic statements, only ones specific to this patients case. For instance the doctor reading this has substantial clinical knowledge to support their understanding and it is unhelpful to make basic statements about meaning which they easily know in their context..
- Ensure that there is longer length given to columns which would necessitate it. For instance for Name, it is typical that a name is longer than just 4 characters so this should give apporpriate space. 
- All dates must be in DD/MM/YYYY format
- For "Provider" column, include only the provider's name without their title
- For "Specialty" column, include only their medical specialty, use shorthand where appropriate e.g. Ortho, Plastics, Psychology, Psychiatry, GP, Physio, Exercise Physiologist, Occupational Therapist (so shortened only where posisble while retaining clarity)
- For "Citation" column, use the citation to the vector store, not document titles or filenames
- The "Key Support" columns must contain the objective evidence or reasoning cited by each provider, quoted directly where possible
- Include only substantive clinical disagreements with potential bearing on the claim outcome
- After each table, provide a brief analysis (3-4 sentences) of which position has more substantial evidence or expertise behind it
- Note any specific methodological differences in how providers reached their conclusions
- Note if any provider specifically acknowledged and rebutted another provider's opposing view
- Highlight any disagreements that fall along expected lines (e.g., treating providers vs. IME doctors)
- Pay special attention to disagreements about causation, work capacity, and prognosis

This analysis is essential for weighing medical evidence pursuant to relevant legal standards regarding conflicting expert testimony.

YOUR MOST CRITICAL INSTRUCTION - EVERYTHING MUST HAVE CITATIONS TO THE DOCUMENTS YOU RETRIEVE FROM THE VECTOR STORE`
    },
    {
      id: 'diagnosis-timeline',
      category: 'clinical-opinions',
      summary: 'Diagnosis evolution',
      fullQuery: 'How have the diagnoses or clinical impressions of the patient\'s condition evolved over time?',
      enhancedPrompt: `Create a comprehensive chronological timeline showing how the diagnostic understanding of the patient's condition has evolved from initial presentation to the most recent assessment. Track all formal diagnoses, working diagnoses, and clinical impressions.

FORMAT YOUR RESPONSE AS FOLLOWS:
1. Begin with a brief overview of the initial presentation and most recent diagnostic conclusion.
2. Create a chronological timeline table with these exact columns:
   | Date | Provider | Specialty | Diagnosis/Clinical Impression | Key Diagnostic Evidence | Change from Previous | Citation |

SPECIFIC REQUIREMENTS:
- Never make generic statements, only ones specific to this patients case. For instance the doctor reading this has substantial clinical knowledge to support their understanding and it is unhelpful to make basic statements about meaning which they easily know in their context..
- Ensure that there is longer length given to columns which would necessitate it. For instance for Name, it is typical that a name is longer than just 4 characters so this should give apporpriate space. 
- All dates must be in DD/MM/YYYY format
- For "Provider" column, include only the provider's name without their title
- For "Specialty" column, include only their medical specialty, use shorthand where appropriate e.g. Ortho, Plastics, Psychology, Psychiatry, GP, Physio, Exercise Physiologist, Occupational Therapist (so shortened only where posisble while retaining clarity)
- For "Citation" column, use the citation to the vector store, not document titles or filenames
- The "Change from Previous" column must specifically identify whether this represents a refinement, confirmation, contradiction, or extension of previous diagnoses
- For each diagnostic change, include the specific reasoning or new evidence that prompted the change
- Include only formal clinical assessments from qualified healthcare providers
- When multiple diagnoses were offered simultaneously, group them together under the same date
- Distinguish between definitive diagnoses and differential/provisional diagnoses
- After the timeline, provide a summarizing paragraph explaining the overall diagnostic trajectory and whether it represents typical clinical progression for this type of condition
- Note any unusual gaps in the diagnostic timeline or unexplained diagnostic shifts
- Pay particular attention to how diagnostic terminology may have shifted while describing the same underlying condition

This timeline is crucial for understanding diagnostic certainty as it relates to the "current diagnosis" requirements under WorkCover WA guidelines and medical assessment protocols.

YOUR MOST CRITICAL INSTRUCTION - EVERYTHING MUST HAVE CITATIONS TO THE DOCUMENTS YOU RETRIEVE FROM THE VECTOR STORE`
    },
    {
      id: 'causation-assessment',
      category: 'clinical-opinions',
      summary: 'Injury causation opinions',
      fullQuery: 'Which practitioners attribute the patient\'s condition to the workplace accident/MVA and which suggest other causes?',
      enhancedPrompt: `Analyze all medical opinions regarding the causal relationship between the claimed incident and the patient's current condition. Identify how different providers have attributed causation, including those who suggest alternative causes.

FORMAT YOUR RESPONSE AS FOLLOWS:
1. Begin with an executive summary (Do not write the title 'Executive summary', just do dot points) of the main causation theories present in the file.
2. Create a table with these exact columns:
   | Provider | Specialty | Date | Causation Determination | Certainty Language | Key Reasoning | Alternative Factors Noted | Citation |

3. After the table, organize providers into clearly labeled groups:
   A. Those attributing the condition PRIMARILY to the claimed incident
   B. Those indicating PARTIAL contribution from the claimed incident
   C. Those attributing the condition to ALTERNATIVE causes
   D. Those UNABLE TO DETERMINE causation

SPECIFIC REQUIREMENTS:
- Never make generic statements, only ones specific to this patients case. For instance the doctor reading this has substantial clinical knowledge to support their understanding and it is unhelpful to make basic statements about meaning which they easily know in their context..
- Ensure that there is longer length given to columns which would necessitate it. For instance for Name, it is typical that a name is longer than just 4 characters so this should give apporpriate space. 
- All dates must be in DD/MM/YYYY format
- For "Provider" column, include only the provider's name without their title
- For "Specialty" column, include only their medical specialty, use shorthand where appropriate e.g. Ortho, Plastics, Psychology, Psychiatry, GP, Physio, Exercise Physiologist, Occupational Therapist (so shortened only where posisble while retaining clarity)
- For "Citation" column, use the citation to the vector store, not document titles or filenames
- "Certainty Language" must quote the exact words used to express probability (e.g., "possible," "likely," "definite")
- "Key Reasoning" must include the clinical basis for the causation opinion, quoted where possible
- "Alternative Factors" must list any pre-existing conditions, degenerative processes, or other incidents mentioned
- Include ALL providers who expressed a causation opinion, even if brief
- Pay special attention to whether providers used legally significant language (e.g., "material contribution," "balance of probabilities")
- Note if any provider specifically addressed the requirements of relevant legislation in their causation analysis
- For each causation group (A-D), provide a brief summary of the qualifications and examination thoroughness of its members

This causation analysis directly relates to the "injury" definition under s.5 of the Workers' Compensation and Injury Management Act 1981 (WA) or liability determination under the Motor Vehicle (Third Party Insurance) Act 1943 (WA).

YOUR MOST CRITICAL INSTRUCTION - EVERYTHING MUST HAVE CITATIONS TO THE DOCUMENTS YOU RETRIEVE FROM THE VECTOR STORE`
    },
    {
      id: 'pre-existing-analysis',
      category: 'clinical-opinions',
      summary: 'Pre-existing condition impact',
      fullQuery: 'Is there evidence of any pre-existing injuries or conditions, and what did doctors say about their role?',
      enhancedPrompt: `Comprehensively analyze all references to pre-existing medical conditions or injuries that may relate to the current claim. Focus on how different providers assessed the relationship between pre-existing conditions and the current presentation.

FORMAT YOUR RESPONSE AS FOLLOWS:
1. Begin with an executive summary (Do not write the title 'Executive summary, just do dot points) listing all identified pre-existing conditions potentially relevant to the current claim.
2. For each pre-existing condition, create a section with:
   A. Brief description of the condition and when it was first documented
   B. A table with these exact columns:
      | Date | Provider | Specialty | Assessment of Relevance | Impact on Current Condition | Supporting Evidence | Citation |

SPECIFIC REQUIREMENTS:
- Never make generic statements, only ones specific to this patients case. For instance the doctor reading this has substantial clinical knowledge to support their understanding and it is unhelpful to make basic statements about meaning which they easily know in their context..
- Ensure that there is longer length given to columns which would necessitate it. For instance for Name, it is typical that a name is longer than just 4 characters so this should give apporpriate space. 
- All dates must be in DD/MM/YYYY format
- For "Provider" column, include only the provider's name without their title
- For "Specialty" column, include only their medical specialty, use shorthand where appropriate e.g. Ortho, Plastics, Psychology, Psychiatry, GP, Physio, Exercise Physiologist, Occupational Therapist (so shortened only where posisble while retaining clarity)
- For "Citation" column, use the citation to the vector store, not document titles or filenames
- "Assessment of Relevance" must categorize the provider's opinion (e.g., "Unrelated," "Contributory," "Primary Cause")
- "Impact on Current Condition" must summarize how the provider believes the pre-existing condition affects the presentation
- "Supporting Evidence" must include specific findings cited by the provider (e.g., imaging results, examination findings)
- Include only conditions documented before the date of the claimed incident
- After each condition's table, summarize (3-4 sentences) the consensus or conflict regarding its relevance
- Pay special attention to conditions affecting the same body region as the claimed injury
- Note any providers who conducted specific testings to distinguish pre-existing from new pathology
- Include any provider statements about aggravation or acceleration of pre-existing conditions
- Highlight any documentation that predates the injury event showing symptom-free status or full function

This analysis is crucial for assessing causation under the "egg-shell skull" principle established in Kavanagh v Commonwealth [1960] HCA 25 and the aggravation provisions in s.5 of the Workers' Compensation and Injury Management Act 1981 (WA).

YOUR MOST CRITICAL INSTRUCTION - EVERYTHING MUST HAVE CITATIONS TO THE DOCUMENTS YOU RETRIEVE FROM THE VECTOR STORE`
    },
    {
      id: 'mechanism-validation',
      category: 'clinical-opinions',
      summary: 'Injury mechanism assessment',
      fullQuery: 'Did any doctor question whether the described mechanism of injury could cause the reported condition?',
      enhancedPrompt: `Identify all instances where medical providers have evaluated the biomechanical plausibility of the reported injury mechanism in relation to the diagnosed condition(s). Focus on opinions about whether the described incident could reasonably cause the clinical presentation.

FORMAT YOUR RESPONSE AS FOLLOWS:
1. 1. Begin with an executive summary (Do not write the title 'Executive summary', just do dot points) of the claimed injury mechanism as most consistently reported.
2. Create a table with these exact columns:
   | Provider | Specialty | Date | Assessment of Mechanism | Key Quote | Biomechanical Reasoning | Citation |

3. After the table, organize providers into clearly labeled categories:
   A. Those who EXPLICITLY VALIDATED the injury mechanism as consistent with the diagnosis
   B. Those who EXPLICITLY QUESTIONED the injury mechanism as inconsistent with the diagnosis
   C. Those who IMPLICITLY ACCEPTED the mechanism (by not questioning it while offering causation opinions)
   D. Those who NOTED INCONSISTENCIES in how the mechanism was described

SPECIFIC REQUIREMENTS:
- Never make generic statements, only ones specific to this patients case. For instance the doctor reading this has substantial clinical knowledge to support their understanding and it is unhelpful to make basic statements about meaning which they easily know in their context..
- Ensure that there is longer length given to columns which would necessitate it. For instance for Name, it is typical that a name is longer than just 4 characters so this should give apporpriate space. 
- All dates must be in DD/MM/YYYY format
- For "Provider" column, include only the provider's name without their title
- For "Specialty" column, include only their medical specialty, use shorthand where appropriate e.g. Ortho, Plastics, Psychology, Psychiatry, GP, Physio, Exercise Physiologist, Occupational Therapist (so shortened only where posisble while retaining clarity)
- For "Citation" column, use the citation to the vector store, not document titles or filenames
- "Assessment of Mechanism" must categorize the provider's conclusion (e.g., "Consistent," "Unlikely," "Possible")
- "Key Quote" must contain verbatim language regarding the mechanism-injury relationship
- "Biomechanical Reasoning" must include specific scientific or clinical reasoning provided
- Pay special attention to discussions of force vectors, energy transfer, or typical injury patterns
- Note any providers who cited medical literature or research regarding typical mechanisms for this injury
- Highlight any inconsistencies in how the injury mechanism was described to different providers
- For category B providers (those questioning the mechanism), include their specific alternative explanations
- Note the timing of assessments (providers seeing the patient earlier may have different information)

This mechanism analysis is particularly relevant to causation determination under the "but for" test established in March v E & MH Stramare Pty Ltd [1991] HCA 12 and applies to both workers' compensation and motor vehicle accident cases in Western Australia.`
    },
    
    // Clinical Findings & Progression
    {
      id: 'symptom-progression',
      category: 'clinical-findings',
      summary: 'Symptom progression timeline',
      fullQuery: 'How have the patient\'s reported symptoms and examination findings changed over time?',
      enhancedPrompt: `Construct a detailed timeline tracking the progression of the patient's symptoms and objective clinical findings from initial presentation to the most recent assessment. Identify patterns of improvement, deterioration, or fluctuation.

FORMAT YOUR RESPONSE AS FOLLOWS:
1. Begin with an executive summary (Do not write the title 'Executive summary', just do dot points) of the initial presentation and the most recent status.
2. Create a chronological table with these exact columns:
   | Date | Provider | Specialty | Symptoms Reported | Objective Findings | Change from Previous Visit | Treatment at Time | Citation |

3. After the comprehensive table, create a condensed symptom trajectory section that groups similar periods:
   A. Initial presentation period (first 2-4 weeks): Brief summary
   B. Early treatment period: Brief summary
   C. Intermediate period: Brief summary
   D. Recent status (last 3 months): Brief summary

SPECIFIC REQUIREMENTS:
- Never make generic statements, only ones specific to this patients case. For instance the doctor reading this has substantial clinical knowledge to support their understanding and it is unhelpful to make basic statements about meaning which they easily know in their context..
- Ensure that there is longer length given to columns which would necessitate it. For instance for Name, it is typical that a name is longer than just 4 characters so this should give apporpriate space. 
- All dates must be in DD/MM/YYYY format
- For "Provider" column, include only the provider's name without their title
- For "Specialty" column, include only their medical specialty, use shorthand where appropriate e.g. Ortho, Plastics, Psychology, Psychiatry, GP, Physio, Exercise Physiologist, Occupational Therapist (so shortened only where posisble while retaining clarity)
- For "Citation" column, use the citation to the vector store, not document titles or filenames
- "Symptoms Reported" must include only subjective complaints expressed by the patient
- "Objective Findings" must include only measurable clinical signs (e.g., range of motion, muscle testing, reflex testing)
- "Change from Previous" must specifically categorize the direction of change (e.g., "Improved," "Worsened," "Unchanged")
- Distinguish between treating provider and independent examiner findings
- Include measured values where available (e.g., "30° shoulder abduction," "4/5 quadriceps strength")
- Note any significant gaps in the clinical record where progression cannot be tracked
- Highlight any sudden changes in symptom pattern or examination findings
- Correlate changes with treatment interventions or life events when mentioned
- Pay special attention to findings related to work capacity assessment

This symptom progression analysis is essential for establishing the "incapacity" element under s.19 of the Workers' Compensation and Injury Management Act 1981 (WA) or determining impairment under the Civil Liability Act 2002 (WA) for motor vehicle cases.

YOUR MOST CRITICAL INSTRUCTION - EVERYTHING MUST HAVE CITATIONS TO THE DOCUMENTS YOU RETRIEVE FROM THE VECTOR STORE`
    },
    {
      id: 'objective-findings',
      category: 'clinical-findings',
      summary: 'Objective clinical evidence',
      fullQuery: 'What objective clinical evidence (physical examination, diagnostic tests, imaging) supports or contradicts the claimed diagnosis?',
      enhancedPrompt: `Extract and analyze all objective clinical evidence related to the claimed condition, including physical examination findings, diagnostic test results, and imaging studies. Distinguish between findings that support and those that contradict the claimed diagnosis.

FORMAT YOUR RESPONSE AS FOLLOWS:
1. 1. Begin with an executive summary (Do not write the title 'Executive summary', just do dot points)  of the main objective findings and their significance to the claim.
2. Organize by evidence type with separate sections for:
   A. Imaging Studies (X-ray, MRI, CT, ultrasound, etc.)
   B. Diagnostic Tests (EMG/NCS, pathology, functional tests, etc.)
   C. Physical Examination Findings (ROM, strength, special tests, etc.)

3. For each section, create a table with these exact columns:
   | Date | Provider | Specialty | Test/Examination | Finding | Supports/Contradicts | Citation |

SPECIFIC REQUIREMENTS:
- Never make generic statements, only ones specific to this patients case. For instance the doctor reading this has substantial clinical knowledge to support their understanding and it is unhelpful to make basic statements about meaning which they easily know in their context..
- Ensure that there is longer length given to columns which would necessitate it. For instance for Name, it is typical that a name is longer than just 4 characters so this should give apporpriate space. 
- All dates must be in DD/MM/YYYY format
- For "Provider" column, include only the provider's name without their title
- For "Specialty" column, include only their medical specialty, use shorthand where appropriate e.g. Ortho, Plastics, Psychology, Psychiatry, GP, Physio, Exercise Physiologist, Occupational Therapist (so shortened only where posisble while retaining clarity)
- For "Citation" column, use the citation to the vector store, not document titles or filenames
- "Finding" must contain the actual measured result or specific observation, quoted where possible
- "Supports or Contradicts" must clearly state whether the finding is consistent with the claimed condition
- Include ONLY objective findings, not subjective reports or symptoms
- For imaging, distinguish between the radiologist's report and treating doctors' interpretations
- For physical examinations, focus on reproducible and measurable findings
- Highlight any significant discrepancies between different providers' findings
- Note findings that suggest non-organic or psychosocial components
- After each section, provide a brief synthesis (2-3 sentences) of what the findings collectively indicate
- Pay special attention to objective evidence that specifically addresses causation
- For conflicting findings, note the relative timing, provider specialization, and examination thoroughness

This objective evidence analysis is central to meeting the diagnostic criteria under the WorkCover WA Guidelines for the Evaluation of Permanent Impairment and AMA Guides typically used in Western Australian medicolegal assessments.

YOUR MOST CRITICAL INSTRUCTION - EVERYTHING MUST HAVE CITATIONS TO THE DOCUMENTS YOU RETRIEVE FROM THE VECTOR STORE`
    },
    {
      id: 'diagnostic-testing',
      category: 'clinical-findings',
      summary: 'Diagnostic test results',
      fullQuery: 'What do the imaging reports and diagnostic tests show about the injury, and how do different doctors interpret these findings?',
      enhancedPrompt: `Provide a comprehensive analysis of all diagnostic testing related to the claimed condition, focusing on both the raw results and how different providers interpreted these findings. Compare specialist (e.g., radiologist) interpretations with treating and examining doctors' conclusions.

FORMAT YOUR RESPONSE AS FOLLOWS:
1. Begin with an overview summarizing the key diagnostic studies performed and their general significance.
2. Organize by body region/system, then by test type chronologically.
3. For each diagnostic study, create a detailed entry with:
   A. Test Details: [Test Type] - [Date] - [Facility] - [Ordering Provider] - [Citation]
   B. A table with these exact columns:
      | Interpreter | Specialty | Date | Role | Key Findings | Clinical Correlation | Significance to Claim | Citation |

SPECIFIC REQUIREMENTS:
- Never make generic statements, only ones specific to this patients case. For instance the doctor reading this has substantial clinical knowledge to support their understanding and it is unhelpful to make basic statements about meaning which they easily know in their context..
- Ensure that there is longer length given to columns which would necessitate it. For instance for Name, it is typical that a name is longer than just 4 characters so this should give apporpriate space. 
- All dates must be in DD/MM/YYYY format
- For "Interpreter" column, include only the provider's name without their title
- For "Specialty" column, include only their medical specialty, use shorthand where appropriate e.g. Ortho, Plastics, Psychology, Psychiatry, GP, Physio, Exercise Physiologist, Occupational Therapist (so shortened only where posisble while retaining clarity)
- For "Citation" column, use the citation to the vector store, not document titles or filenames
- "Key Findings" must quote the actual results verbatim, focusing on positive and negative findings relevant to the claim
- "Clinical Correlation" must summarize how the interpreter connected findings to symptoms or diagnosis
- "Significance to Claim" must assess whether the finding supports, contradicts, or is neutral to the claimed condition
- For each test, note any significant discrepancies between different providers' interpretations
- Highlight instances where providers cite the same test but reach different conclusions
- Include normal/negative findings that are significant for ruling out conditions
- Note any recommended follow-up studies and whether they were performed
- Pay special attention to comments about acute versus chronic/degenerative findings
- After all tests for a body region, provide a brief synthesis of the collective diagnostic evidence

This diagnostic testing analysis is essential for establishing objective medical evidence as required under both the workers' compensation framework and the motor vehicle injury assessment protocols in Western Australia.

YOUR MOST CRITICAL INSTRUCTION - EVERYTHING MUST HAVE CITATIONS TO THE DOCUMENTS YOU RETRIEVE FROM THE VECTOR STORE`
    },
    {
      id: 'non-organic-findings',
      category: 'clinical-findings',
      summary: 'Non-organic findings',
      fullQuery: 'Did any examiner record signs of non-organic findings, symptom exaggeration, or inconsistent effort?',
      enhancedPrompt: `Identify all instances where medical providers documented potential non-organic findings, symptom magnification, inconsistent effort, or other findings suggesting psychological overlay or non-physiological components to the presentation.

FORMAT YOUR RESPONSE AS FOLLOWS:
1. Begin with a concise statement about whether such findings were documented and their general pattern.
2. Create a chronological table with these exact columns:
   | Date | Provider | Specialty | Non-organic Finding | Assessment Method | Provider's Interpretation | Citation |

3. After the table, organize the findings into these categories (if present):
   A. Waddell's signs or similar validated non-organic tests
   B. Inconsistent performance on examination (e.g., distracted vs. formal testing)
   C. Symptom reports inconsistent with anatomical or physiological patterns
   D. Validity indicators on formal testing (e.g., grip strength curves, functional capacity evaluations)
   E. Observations of behaviors inconsistent with reported limitations

SPECIFIC REQUIREMENTS:
- Never make generic statements, only ones specific to this patients case. For instance the doctor reading this has substantial clinical knowledge to support their understanding and it is unhelpful to make basic statements about meaning which they easily know in their context..
- Ensure that there is longer length given to columns which would necessitate it. For instance for Name, it is typical that a name is longer than just 4 characters so this should give apporpriate space. 
- All dates must be in DD/MM/YYYY format
- For "Provider" column, include only the provider's name without their title
- For "Specialty" column, include only their medical specialty, use shorthand where appropriate e.g. Ortho, Plastics, Psychology, Psychiatry, GP, Physio, Exercise Physiologist, Occupational Therapist (so shortened only where posisble while retaining clarity)
- For "Citation" column, use the citation to the vector store, not document titles or filenames
- "Non-organic Finding" must describe the specific observation using the provider's exact terminology
- "Assessment Method" must detail how the finding was elicited or observed
- "Provider's Interpretation" must quote the clinical significance attributed by the provider
- Include all providers who specifically addressed or tested for non-organic components
- Note providers who explicitly stated they did NOT find evidence of non-organic findings
- Include only documented observations, not inferences or opinions without supporting evidence
- Note the qualifications of providers making these assessments (e.g., specialized training)
- Highlight any patterns in when these findings were observed (e.g., specific examiners, specific contexts)
- For each finding category (A-E), provide a brief summary of its clinical significance

This analysis of non-organic findings relates directly to credibility assessment in medicolegal contexts and may impact determinations under both the Workers' Compensation and Injury Management Act 1981 (WA) and motor vehicle injury compensation systems, particularly regarding impairment assessment methodology.

YOUR MOST CRITICAL INSTRUCTION - EVERYTHING MUST HAVE CITATIONS TO THE DOCUMENTS YOU RETRIEVE FROM THE VECTOR STORE`
    },
    {
      id: 'consistency-analysis',
      category: 'clinical-findings',
      summary: 'Presentation consistency',
      fullQuery: 'Is there consistency in how the patient described the injury, symptoms, and limitations to different providers?',
      enhancedPrompt: `Analyze the consistency of the patient's reported history, symptom descriptions, and functional limitations across all healthcare providers and assessments. Identify significant variations or discrepancies in the patient's account.

FORMAT YOUR RESPONSE AS FOLLOWS:
1. Begin with an executive summary (no header , just dot points) of overall consistency patterns.
2. Create separate sections for:
   A. Injury Mechanism Consistency
   B. Symptom Report Consistency
   C. Functional Limitation Consistency
   D. Treatment Response Consistency

3. For each section, create a table with these exact columns:
   | Date | Provider | Specialty | Patient's Report | Consistency Assessment | Notable Variations | Citation |

SPECIFIC REQUIREMENTS:
- Never make generic statements, only ones specific to this patients case. For instance the doctor reading this has substantial clinical knowledge to support their understanding and it is unhelpful to make basic statements about meaning which they easily know in their context..
- Ensure that there is longer length given to columns which would necessitate it. For instance for Name, it is typical that a name is longer than just 4 characters so this should give apporpriate space. 
- All dates must be in DD/MM/YYYY format
- For "Provider" column, include only the provider's name without their title
- For "Specialty" column, include only their medical specialty, use shorthand where appropriate e.g. Ortho, Plastics, Psychology, Psychiatry, GP, Physio, Exercise Physiologist, Occupational Therapist (so shortened only where posisble while retaining clarity)
- For "Citation" column, use the citation to the vector store, not document titles or filenames
- "Patient's Report" must summarize what the patient told each provider
- "Consistency Assessment" must categorize the level of consistency with previous reports
- "Notable Variations" must highlight specific discrepancies or new elements in the account
- Include chronological progression to show how the narrative evolved
- Distinguish between minor variations and significant contradictions
- Note when providers explicitly commented on consistency or inconsistency
- Consider contextual factors that might explain some variations (e.g., specific questioning)
- Highlight instances where providers recorded their impression of the patient's reliability
- After each section table, provide a brief analysis of the pattern of consistency/inconsistency
- Pay special attention to functional claims that may impact work capacity assessment

This consistency analysis is particularly relevant to credibility assessment in both workers' compensation matters (especially in contested claims) and motor vehicle accident cases where compensation depends on accurate symptom reporting.`
    },
    
    // Treatment & Management
    {
      id: 'treatment-history',
      category: 'treatment',
      summary: 'Complete treatment history',
      fullQuery: 'What treatments and interventions has the patient undergone, and what outcomes were noted after each?',
      enhancedPrompt: `Create a comprehensive chronological record of all treatments provided for the claimed condition, including conservative care, medications, injections, procedures, surgeries, and therapeutic modalities. Document the outcomes and effectiveness of each intervention.

FORMAT YOUR RESPONSE AS FOLLOWS:
1. 1. Begin with an executive summary (Do not write the title 'Executive summary', just do dot points)  of the overall treatment approach and general trajectory.
2. Organize treatments by type with separate sections for:
   A. Medications
   B. Physical/Occupational Therapy
   C. Injections/Procedures
   D. Surgeries
   E. Other Interventions (e.g., psychological, alternative medicine)

3. For each section, create a detailed chronological table with these exact columns:
   | Date Range | Treatment Details | Provider | Specialty | Reported Outcome | Objective Change | Citation |

SPECIFIC REQUIREMENTS:
- Never make generic statements, only ones specific to this patients case. For instance the doctor reading this has substantial clinical knowledge to support their understanding and it is unhelpful to make basic statements about meaning which they easily know in their context..
- Ensure that there is longer length given to columns which would necessitate it. For instance for Name, it is typical that a name is longer than just 4 characters so this should give apporpriate space. 
- All dates must be in DD/MM/YYYY format
- For "Provider" column, include only the provider's name without their title
- For "Specialty" column, include only their medical specialty, use shorthand where appropriate e.g. Ortho, Plastics, Psychology, Psychiatry, GP, Physio, Exercise Physiologist, Occupational Therapist (so shortened only where posisble while retaining clarity)
- For "Citation" column, use the citation to the vector store, not document titles or filenames
- "Treatment Details" must include specific medication names/dosages, procedure types, therapy protocols, etc.
- "Reported Outcome" must summarize the documented patient response and provider assessment
- "Objective Change" must note any measured improvement in function, ROM, strength, etc.
- Note any treatments that were recommended but declined or not approved
- Highlight treatments that produced significant improvement or deterioration
- Document side effects, complications, or adverse reactions
- After each treatment type section, provide a brief summary of the pattern of response to that modality
- Track the progression from conservative to more invasive treatments where applicable
- Note the duration and frequency of each treatment modality
- Include provider statements about whether the response was typical/expected
- Pay special attention to how treatment responses informed work capacity decisions

This treatment history analysis is essential for evaluating "reasonable medical treatment" under s.19 of the Workers' Compensation and Injury Management Act 1981 (WA) and for assessing mitigation of damages in motor vehicle cases under the Civil Liability Act 2002 (WA).

YOUR MOST CRITICAL INSTRUCTION - EVERYTHING MUST HAVE CITATIONS TO THE DOCUMENTS YOU RETRIEVE FROM THE VECTOR STORE`
    },
    {
      id: 'treatment-recommendations',
      category: 'treatment',
      summary: 'Future treatment needs',
      fullQuery: 'What future treatments have been recommended, and what is their expected benefit?',
      enhancedPrompt: `Identify all recommendations for future treatment, rehabilitation, or management of the claimed condition. Detail the expected benefits, likelihood of improvement, estimated costs, and timeframes provided by the recommending practitioners.

FORMAT YOUR RESPONSE AS FOLLOWS:
1. 1. Begin with an executive summary (Do not write the title 'Executive summary', just do dot points)  of the main treatment recommendations and their collective purpose.
2. Create a table with these exact columns:
   | Recommended Treatment | Date | Recommending Provider | Specialty | Purpose | Timeframe | Approval Status | Citation |

3. After the comprehensive table, organize recommendations into these categories:
   A. Curative Treatments (intended to resolve the condition)
   B. Symptom Management (intended for ongoing pain/symptom control)
   C. Functional Improvement (aimed at maximizing function despite permanent impairment)
   D. Diagnostic/Assessment (further testing or evaluation)

SPECIFIC REQUIREMENTS:
- Never make generic statements, only ones specific to this patients case. For instance the doctor reading this has substantial clinical knowledge to support their understanding and it is unhelpful to make basic statements about meaning which they easily know in their context..
- Ensure that there is longer length given to columns which would necessitate it. For instance for Name, it is typical that a name is longer than just 4 characters so this should give apporpriate space. 
- All dates must be in DD/MM/YYYY format
- For "Recommending Provider" column, include only the provider's name without their title
- For "Specialty" column, include only their medical specialty, use shorthand where appropriate e.g. Ortho, Plastics, Psychology, Psychiatry, GP, Physio, Exercise Physiologist, Occupational Therapist (so shortened only where posisble while retaining clarity)
- For "Citation" column, use the citation to the vector store, not document titles or filenames
- "Purpose/Expected Benefit" must quote the provider's specific expected outcome
- "Timeframe" must include both expected duration of treatment and anticipated recovery period
- "Approval Status" must note whether the treatment has been approved, denied, or is pending insurance decision
- Include only treatments formally recommended by qualified healthcare providers
- Note the degree of consensus or disagreement about recommended treatments
- Highlight treatments described as "essential" versus "optional" or "worth trying"
- Document the clinical reasoning supporting major interventions
- Note any second opinions specifically sought regarding treatment recommendations
- After each category section, summarize the expected overall benefit of the recommended approach
- Pay special attention to statements about whether the patient will reach maximum medical improvement without the recommended treatment

This future treatment analysis directly relates to the "future treatment costs" component of compensation under both workers' compensation and motor vehicle accident frameworks in Western Australia, particularly regarding section 217 of the Workers' Compensation and Injury Management Act 1981 (WA) concerning future medical expenses.

YOUR MOST CRITICAL INSTRUCTION - EVERYTHING MUST HAVE CITATIONS TO THE DOCUMENTS YOU RETRIEVE FROM THE VECTOR STORE`
    },
    {
      id: 'treatment-conflicts',
      category: 'treatment',
      summary: 'Treatment approach disagreements',
      fullQuery: 'Do the doctors agree on the appropriate treatment plan, or are there conflicting recommendations?',
      enhancedPrompt: `Analyze all treatment recommendations to identify agreements and disagreements between providers regarding the appropriate management approach. Focus on substantive conflicts in treatment philosophy or recommendations that could affect the patient's recovery or claim.

FORMAT YOUR RESPONSE AS FOLLOWS:
• Begin with concise bullet points summarizing key agreements and disagreements
• No header needed for this section
• Focus only on the most significant treatment conflicts

## Detailed Analysis Structure
For each identified treatment conflict:

### 1. Issue Statement
Provide a precise description of the treatment disagreement (e.g., "Surgical Intervention for Lumbar Disc Herniation")

### 2. Conflicting Positions
**Position A:**
- **Advocates:** Provider names (without titles)
- **Specialties:** Medical specialties of advocates
- **Clinical Rationale:** Medical reasoning supporting this approach
- **Evidence:** Guidelines or research cited to support position

**Position B:**
- **Advocates:** Provider names (without titles)
- **Specialties:** Medical specialties of advocates 
- **Clinical Rationale:** Medical reasoning supporting this approach
- **Evidence:** Guidelines or research cited to support position

### 3. Resolution Status
- Indicate how the conflict was resolved (e.g., "Followed Position A," "Pending," "Compromise")
- Note if resolution aligns with clinical guidelines for the condition


YOUR MOST CRITICAL INSTRUCTION - EVERYTHING MUST HAVE CITATIONS TO THE DOCUMENTS YOU RETRIEVE FROM THE VECTOR STORE`
    },
    {
      id: 'treatment-compliance',
      category: 'treatment',
      summary: 'Treatment compliance',
      fullQuery: 'Did the patient adhere to the recommended treatments? Note any compliance issues mentioned.',
      enhancedPrompt: `Identify all documentation regarding the patient's compliance with or adherence to recommended treatment plans, medication regimens, home exercise programs, activity restrictions, and attendance at scheduled appointments. Focus on explicitly documented compliance issues rather than inferences.

FORMAT YOUR RESPONSE AS FOLLOWS:
1. 1. Begin with an executive summary (Do not write the title 'Executive summary', just do dot points)  of the overall compliance pattern.
2. Create a chronological table with these exact columns:
   | Date | Provider | Specialty | Treatment | Compliance | Provider's Notation | Citation |

3. After the comprehensive table, organize by treatment type with sections for:
   A. Medication Compliance
   B. Therapy/Rehabilitation Attendance and Participation
   C. Home Exercise/Self-Care Program Adherence
   D. Activity/Work Restrictions Compliance
   E. Appointment Attendance

SPECIFIC REQUIREMENTS:
- Never make generic statements, only ones specific to this patients case. For instance the doctor reading this has substantial clinical knowledge to support their understanding and it is unhelpful to make basic statements about meaning which they easily know in their context..
- Ensure that there is longer length given to columns which would necessitate it. For instance for Name, it is typical that a name is longer than just 4 characters so this should give apporpriate space. 
- All dates must be in DD/MM/YYYY format
- For "Provider" column, include only the provider's name without their title
- For "Specialty" column, include only their medical specialty, use shorthand where appropriate e.g. Ortho, Plastics, Psychology, Psychiatry, GP, Physio, Exercise Physiologist, Occupational Therapist (so shortened only where posisble while retaining clarity)
- For "Citation" column, use the citation to the vector store, not document titles or filenameS. **CRITICALLY THIS MUST BE PRESENT ON EVERY ROW**
- "Treatment" must specify exactly what aspect of treatment is being assessed
- "Compliance" must categorize compliance (e.g., "Full," "Partial," "Poor," "Unknown")
- "Provider's Notation" must quote the exact language used to describe compliance
- Include only explicit provider documentation about compliance, not assumptions
- Note instances where providers specifically documented good compliance
- Highlight any explanations given for non-compliance (e.g., side effects, financial constraints, access issues)
- Include documentation of the patient's own reports about treatment adherence
- Note any pattern of increasing or decreasing compliance over time
- Pay special attention to compliance issues that providers linked to delayed recovery
- After each section, summarize whether compliance issues appear to have significantly affected outcomes

This compliance analysis is relevant to the "reasonable steps to mitigate damage" principle applicable in compensation claims, and to assessing the validity of "failure to mitigate" defenses sometimes raised in both workers' compensation and motor vehicle accident claims in Western Australia.

YOUR MOST CRITICAL INSTRUCTION - EVERYTHING MUST HAVE CITATIONS TO THE DOCUMENTS YOU RETRIEVE FROM THE VECTOR STORE`
    },
    {
      id: 'maximum-medical-improvement',
      category: 'treatment',
      summary: 'Maximum medical improvement status',
      fullQuery: 'Has any provider indicated that the patient has reached maximum medical improvement (MMI) or a recovery plateau?',
      enhancedPrompt: `Identify all provider statements regarding whether the patient has reached maximum medical improvement (MMI), a recovery plateau, or a stable and stationary status. Focus on formal assessments of whether further significant recovery is expected.
## FORMAT FOR RESPONSE:

1. Begin with a concise statement about whether MMI has been formally determined and the consensus view.

2. Present chronological assessments using this structure:
   * **Date (DD/MM/YYYY)**
     * **Provider:** [Name only, no titles]
     * **Specialty:** [Medical specialty, using appropriate shorthand]
     * **MMI Determination:** [Clear categorization - "MMI Reached," "Not at MMI," etc.]
     * **Rationale:** [Clinical reasoning behind determination]
     * **Exceptions/Conditions:** [Any caveats to MMI status]
     * **Citation:** [Vector store reference, not document titles]

3. If MMI has been determined, conclude with:
   * Earliest formal MMI documentation date
   * Consensus status (unanimous or contested)
   * Context (with/without specific future treatments)
   * Permanence assessment (temporary or permanent)

## SPECIFIC REQUIREMENTS:

- Provide only patient-specific information, avoiding generic clinical statements
- Use DD/MM/YYYY date format consistently
- Include provider names without titles
- Use appropriate medical specialty shorthand
- Use precise citations to the vector store
- Categorize MMI assessments clearly
- Summarize clinical reasoning behind determinations
- Note any permanent impairment identified
- List exceptions or conditions affecting MMI status
- Quote providers' exact MMI language where possible
- Distinguish between treating providers and independent examiners
- Highlight significant disagreements between providers
- Note connections between MMI and return-to-work recommendations
- Identify treatments that might change MMI status
`
    },
    
    // Functional Capacity & Work Status
    {
      id: 'work-capacity',
      category: 'functional-capacity',
      summary: 'Work capacity assessments',
      fullQuery: 'What do the documents say about the patient\'s capacity for work and return-to-work potential?',
      enhancedPrompt: `Analyze all assessments of work capacity, medical restrictions, and return-to-work potential documented throughout the claim. Track how these assessments evolved over time and note differences between provider opinions.

FORMAT YOUR RESPONSE AS FOLLOWS:
1. 1. Begin with an executive summary (Do not write the title 'Executive summary', just do dot points)  of the current work status and capacity trajectory.
2. Create a chronological table with these exact columns:
   | Date | Provider | Specialty | Work Capacity | Restrictions | Duration | Medical Basis | Citation |

3. After the comprehensive table, create these specific sections:
   A. Current Work Status: Detail the most recent formal work capacity assessment
   B. Work Capacity Evolution: Summarize the progression of capacity determinations
   C. Provider Disagreements: Highlight any significant differences in work capacity opinions
   D. Restrictions Chronology: Track how specific restrictions changed over time

SPECIFIC REQUIREMENTS:
- Never make generic statements, only ones specific to this patients case. For instance the doctor reading this has substantial clinical knowledge to support their understanding and it is unhelpful to make basic statements about meaning which they easily know in their context..
- Ensure that there is longer length given to columns which would necessitate it. For instance for Name, it is typical that a name is longer than just 4 characters so this should give apporpriate space. 
- All dates must be in DD/MM/YYYY format
- For "Provider" column, include only the provider's name without their title
- For "Specialty" column, include only their medical specialty, use shorthand where appropriate e.g. Ortho, Plastics, Psychology, Psychiatry, GP, Physio, Exercise Physiologist, Occupational Therapist (so shortened only where posisble while retaining clarity)
- For "Citation" column, use the citation to the vector store, not document titles or filenames
- "Work Capacity" must categorize status (e.g., "No Capacity," "Modified Duties," "Full Capacity")
- "Specific Restrictions" must list exact functional limitations (e.g., "No lifting >5kg," "No overhead reaching")
- "Duration" must indicate whether restrictions are temporary or permanent and any timeframe specified
- "Medical Basis" must summarize the clinical reasoning for the restrictions
- Include all formal certifications (e.g., WorkCover certificates) as well as clinical notes
- Distinguish between treating provider and independent examiner capacity assessments
- Note any patterns in certification (e.g., consistent extensions of similar restrictions)
- Highlight any abrupt changes in work capacity assessments and their documented basis
- Pay special attention to assessments of capacity for pre-injury duties versus alternative duties
- For each major change in work status, note whether it coincided with clinical improvement/deterioration
- Include provider statements about long-term/permanent work capacity and career implications

This work capacity analysis directly relates to "incapacity" compensation under Division 2 of the Workers' Compensation and Injury Management Act 1981 (WA) and economic loss assessment in motor vehicle accident claims.

YOUR MOST CRITICAL INSTRUCTION - EVERYTHING MUST HAVE CITATIONS TO THE DOCUMENTS YOU RETRIEVE FROM THE VECTOR STORE`
    },
    {
      id: 'functional-capacity-results',
      category: 'functional-capacity',
      summary: 'Functional capacity evaluations',
      fullQuery: 'Extract results from all formal functional capacity evaluations or assessments.',
      enhancedPrompt: `Identify and analyze all formal functional capacity evaluations (FCEs) and structured assessments of the patient's physical or cognitive capabilities. Focus on objectively measured functional parameters and validity of effort during testing.

FORMAT YOUR RESPONSE AS FOLLOWS:
1. Begin with an overview of all formal functional assessments performed.
2. For each assessment, create a detailed entry with:
   A. Assessment Details: [Assessment Type] - [Date] - [Examiner & Qualification] - [Citation]
   B. A table with these exact columns:
      | Functional Domain | Measured Capacity | Normal/Expected | % of Normal | Validity Indicators | Examiner's Interpretation | Citation |

3. After detailing each assessment, provide:
   A. A comparison of results across multiple assessments if available
   B. A summary of consistency between formal testing and clinical examinations
   C. An analysis of how FCE results related to claimed restrictions and work requirements

SPECIFIC REQUIREMENTS:
- Never make generic statements, only ones specific to this patients case. For instance the doctor reading this has substantial clinical knowledge to support their understanding and it is unhelpful to make basic statements about meaning which they easily know in their context..
- Ensure that there is longer length given to columns which would necessitate it. For instance for Name, it is typical that a name is longer than just 4 characters so this should give apporpriate space. 
- All dates must be in DD/MM/YYYY format
- For "Citation" column, use the citation to the vector store, not document titles or filenames
- "Functional Domain" must specify the exact physical/cognitive function tested
- "Measured Capacity" must provide precise quantitative results where available
- "Normal/Expected" must indicate the benchmark comparison for the patient's age/gender
- "Validity Indicators" must report any measures of effort, consistency, or reliability
- "Examiner's Interpretation" must summarize the clinical significance attributed to the results
- Include only formal, standardized assessments performed by qualified professionals
- Note the methodology used and whether it follows recognized protocols
- Highlight any areas where performance was significantly below expected capacity
- Document specific job demands and how they compare to measured capacities
- Pay special attention to consistency of effort and performance validity measures
- Note whether the examiner considered the results an accurate reflection of true capacity
- Include specific recommendations made based on the functional assessment results

This functional capacity analysis is essential for establishing objective evidence of disability under both workers' compensation frameworks and motor vehicle accident compensation systems, particularly relating to economic loss calculations based on work capacity.

YOUR MOST CRITICAL INSTRUCTION - EVERYTHING MUST HAVE CITATIONS TO THE DOCUMENTS YOU RETRIEVE FROM THE VECTOR STORE`
    },
    {
      id: 'adl-functioning',
      category: 'functional-capacity',
      summary: 'Daily activities & function',
      fullQuery: 'Did any examiner document the patient\'s functional abilities in daily life activities?',
      enhancedPrompt: `Extract all documentation regarding the patient's ability to perform activities of daily living (ADLs), instrumental activities of daily living (IADLs), recreational activities, and household tasks. Focus on how the condition has impacted normal life functioning.

FORMAT YOUR RESPONSE AS FOLLOWS:
1. 1. Begin with an executive summary (Do not write the title 'Executive summary', just do dot points)  of the overall functional impact on daily life.
2. Create a table with these exact columns:
   | Date | Provider | Specialty | Activity Category | Reported Limitations | Provider Assessment | Citation |

3. After the comprehensive table, organize information into these functional domains:
   A. Self-Care Activities (dressing, bathing, grooming, etc.)
   B. Mobility & Transfers (walking, climbing stairs, driving, etc.)
   C. Household Activities (cooking, cleaning, yard work, etc.)
   D. Recreational Activities (sports, hobbies, social activities)
   E. Sleep & Rest (sleep quality, positioning requirements, etc.)

SPECIFIC REQUIREMENTS:
- Never make generic statements, only ones specific to this patients case. For instance the doctor reading this has substantial clinical knowledge to support their understanding and it is unhelpful to make basic statements about meaning which they easily know in their context..
- Ensure that there is longer length given to columns which would necessitate it. For instance for Name, it is typical that a name is longer than just 4 characters so this should give apporpriate space. 
- All dates must be in DD/MM/YYYY format
- For "Provider" column, include only the provider's name without their title
- For "Specialty" column, include only their medical specialty, use shorthand where appropriate e.g. Ortho, Plastics, Psychology, Psychiatry, GP, Physio, Exercise Physiologist, Occupational Therapist (so shortened only where posisble while retaining clarity)
- For "Citation" column, use the citation to the vector store, not document titles or filenames
- "Activity Category" must specify the exact type of activity affected
- "Reported Limitations" must summarize the patient's own description of limitations
- "Provider Assessment" must include the provider's evaluation of reported limitations
- Include both patient self-reports and provider observations/assessments
- Note any formal assessment tools used to evaluate activities of daily living
- Highlight discrepancies between reported capabilities to different providers
- Document activities that were completely prevented versus those modified
- Note activities used by providers as examples of functional improvement or deterioration
- Pay special attention to how ADL limitations correlate with work restrictions
- Include provider statements about expected duration of functional limitations
- After each domain section, summarize the overall impact on that area of functioning

This ADL functioning analysis directly relates to "quality of life" and "pain and suffering" components of compensation under the Civil Liability Act 2002 (WA) for motor vehicle accidents, and to assessment of care needs in seriously injured worker cases.

YOUR MOST CRITICAL INSTRUCTION - EVERYTHING MUST HAVE CITATIONS TO THE DOCUMENTS YOU RETRIEVE FROM THE VECTOR STORE`
    },
    {
      id: 'return-to-work-attempts',
      category: 'functional-capacity',
      summary: 'Return-to-work attempts',
      fullQuery: 'Document all return-to-work attempts and their outcomes.',
      enhancedPrompt: `Identify all attempted returns to work, whether successful or unsuccessful, including graduated returns, work trials, and alternative duties. Document the outcomes of each attempt and factors contributing to success or failure.

FORMAT YOUR RESPONSE AS FOLLOWS:
1. Begin with an executive summary (no header , just dot points) of all return-to-work (RTW) attempts and overall pattern.
2. Create a chronological table with these exact columns:
   | Date Range | RTW Type | Hours/Duties | Outcome | Contributing Factors | Provider | Specialty | Citation |

3. After the comprehensive table, provide:
   A. Analysis of patterns in successful versus unsuccessful RTW attempts
   B. Summary of workplace accommodations provided or requested
   C. Provider recommendations regarding future RTW planning

SPECIFIC REQUIREMENTS:
- Never make generic statements, only ones specific to this patients case. For instance the doctor reading this has substantial clinical knowledge to support their understanding and it is unhelpful to make basic statements about meaning which they easily know in their context..
- Ensure that there is longer length given to columns which would necessitate it. For instance for Name, it is typical that a name is longer than just 4 characters so this should give apporpriate space. 
- All dates must be in DD/MM/YYYY format
- For "Provider" column, include only the provider's name without their title
- For "Specialty" column, include only their medical specialty, use shorthand where appropriate e.g. Ortho, Plastics, Psychology, Psychiatry, GP, Physio, Exercise Physiologist, Occupational Therapist (so shortened only where posisble while retaining clarity)
- For "Citation" column, use the citation to the vector store, not document titles or filenames
- "RTW Type" must categorize the return (e.g., "Graduated," "Full Duties," "Alternative Position")
- "Hours/Duties" must specify the exact schedule and responsibilities
- "Outcome" must clearly state whether the attempt was successful, partially successful, or unsuccessful
- "Contributing Factors" must list elements that influenced the outcome (medical and non-medical)
- Include all documented RTW attempts from injury to present
- Note whether each RTW was initiated by the worker, employer, provider, or insurer
- Document any formal workplace assessments conducted prior to RTW
- Highlight any symptoms or complications that emerged during RTW attempts
- Note any disagreements between stakeholders about RTW readiness
- Include information about the employer's willingness/ability to accommodate restrictions
- Pay special attention to the correlation between RTW outcomes and clinical status
- For unsuccessful attempts, detail the specific reason for failure and who made the determination

This return-to-work analysis is critical to the injury management requirements under the Workers' Compensation and Injury Management Act 1981 (WA), particularly sections 155B-155E regarding return-to-work programs, and relates to mitigation of damages principles in motor vehicle accident claims.`
    },
    
    // Legal & Procedural Aspects
    {
      id: 'permanent-impairment',
      category: 'legal-aspects',
      summary: 'Permanent impairment ratings',
      fullQuery: 'Compile all permanent impairment or disability ratings provided.',
      enhancedPrompt: `Identify and analyze all formal permanent impairment assessments, disability ratings, and whole person impairment (WPI) determinations related to the claimed condition. Compare methodologies and conclusions across multiple assessments if available.

FORMAT YOUR RESPONSE AS FOLLOWS:
1. Begin with an executive summary (no header , just dot points) of all impairment assessments performed.
2. Create a detailed table with these exact columns:
   | Date | Assessor | Specialty | Assessment Purpose | Methodology/Guide | Body Region | Impairment Rating | Rationale | Citation |

3. If multiple ratings exist, provide:
   A. A comparison table highlighting the differences in methodology and conclusions
   B. An analysis of factors explaining different results
   C. A determination of which assessment appears most consistent with the clinical evidence

SPECIFIC REQUIREMENTS:
- Never make generic statements, only ones specific to this patients case. For instance the doctor reading this has substantial clinical knowledge to support their understanding and it is unhelpful to make basic statements about meaning which they easily know in their context..
- Ensure that there is longer length given to columns which would necessitate it. For instance for Name, it is typical that a name is longer than just 4 characters so this should give apporpriate space. 
- All dates must be in DD/MM/YYYY format
- For "Assessor" column, include only the provider's name without their title
- For "Specialty" column, include only their medical specialty, use shorthand where appropriate e.g. Ortho, Plastics, Psychology, Psychiatry, GP, Physio, Exercise Physiologist, Occupational Therapist (so shortened only where posisble while retaining clarity)
- For "Citation" column, use the citation to the vector store, not document titles or filenames
- "Assessment Purpose" must specify the legislative or insurance framework (e.g., "WorkCover WA," "Motor Vehicle Third Party")
- "Methodology/Guide" must identify the specific edition and chapter of guidelines used (e.g., "AMA 5th Edition")
- "Impairment Rating" must quote the exact percentage and classification assigned
- "Rationale" must summarize the clinical basis and calculation method for the rating
- Include only formal assessments conducted by qualified impairment assessors
- Note whether each assessment followed the proper methodology for the jurisdiction
- Highlight any errors or deviations from standard methodology identified by reviewers
- Include assessments of both whole person impairment and specific body region impairment
- Document whether the assessment considered pre-existing conditions or apportionment
- Note whether the impairment was considered permanent and stationary at assessment
- Pay special attention to whether assessments addressed both physical and psychological impairments
- Include commentary on how any impairment relates to work capacity or functional limitations

This permanent impairment analysis is fundamental to compensation determination under both the workers' compensation framework (particularly for schedule 2 injuries) and the motor vehicle accident assessment guidelines in Western Australia.

YOUR MOST CRITICAL INSTRUCTION - EVERYTHING MUST HAVE CITATIONS TO THE DOCUMENTS YOU RETRIEVE FROM THE VECTOR STORE`
    },
    {
      id: 'legal-causation-language',
      category: 'legal-aspects',
      summary: 'Legal causation terminology',
      fullQuery: 'Did any report reference specific legal tests or use legally significant language when discussing causation?',
      enhancedPrompt: `Identify all instances where medical documents use legally significant terminology or reference specific legal tests when discussing the causal relationship between the claimed incident and the patient's condition. Focus on language that has specific meaning in workers' compensation or motor vehicle accident legislation.

FORMAT YOUR RESPONSE AS FOLLOWS:
1. 1. Begin with an executive summary (Do not write the title 'Executive summary', just do dot points)  of the legal terminology patterns in the medical documentation.
2. Create a table with these exact columns:
   | Date | Provider | Specialty | Legal Term/Test Used | Context | Direct Quote | Citation |

3. After the comprehensive table, organize findings into these categories:
   A. Material Contribution Language
   B. Balance of Probabilities References
   C. Employment Contribution Terminology
   D. Pre-existing Condition Legal Tests
   E. Other Legal Framework References

SPECIFIC REQUIREMENTS:
- Never make generic statements, only ones specific to this patients case. For instance the doctor reading this has substantial clinical knowledge to support their understanding and it is unhelpful to make basic statements about meaning which they easily know in their context..
- Ensure that there is longer length given to columns which would necessitate it. For instance for Name, it is typical that a name is longer than just 4 characters so this should give apporpriate space. 
- All dates must be in DD/MM/YYYY format
- For "Provider" column, include only the provider's name without their title
- For "Specialty" column, include only their medical specialty, use shorthand where appropriate e.g. Ortho, Plastics, Psychology, Psychiatry, GP, Physio, Exercise Physiologist, Occupational Therapist (so shortened only where posisble while retaining clarity)
- For "Citation" column, use the citation to the vector store, not document titles or filenames
- "Legal Term/Test Used" must identify the specific legal concept referenced
- "Context" must explain how the term was applied to this specific case
- "Direct Quote" must provide the exact language used by the provider
- Focus on terminology with specific legal significance (e.g., "material contributing factor," "arising out of or in the course of employment")
- Note any explicit references to legislation, case law, or legal precedents
- Highlight instances where providers appear to be specifically addressing legal criteria
- Include references to legally significant thresholds or requirements
- Note whether the provider appears to understand the legal test being referenced
- Pay special attention to how providers apply legal concepts to medical findings
- Document any instances where providers explicitly disclaim legal expertise while using legal terminology
- Note whether legal terminology appears more frequently in independent examinations versus treating notes

This legal causation language analysis is essential for evaluating whether medical opinions properly address the required elements under s.5 of the Workers' Compensation and Injury Management Act 1981 (WA) regarding injury "arising out of or in the course of employment" or the causation requirements in motor vehicle third party claims.

YOUR MOST CRITICAL INSTRUCTION - EVERYTHING MUST HAVE CITATIONS TO THE DOCUMENTS YOU RETRIEVE FROM THE VECTOR STORE`
    },
    {
      id: 'workcover-certificates',
      category: 'legal-aspects',
      summary: 'WorkCover certification history',
      fullQuery: 'Extract all WorkCover certificates in chronological order.',
      enhancedPrompt: `Compile a comprehensive chronological record of all WorkCover medical certificates issued for this claim. Track the evolution of certified capacity, diagnosed conditions, and medical restrictions over time.

FORMAT YOUR RESPONSE AS FOLLOWS:
1. 1. Begin with an executive summary (Do not write the title 'Executive summary', just do dot points)  of the certification pattern and current status.
2. Create a detailed chronological table with these exact columns:
   | Date | Provider | Specialty | Time Period | Diagnosis | Work Capacity | Specific Restrictions | Next Review | Citation |

3. After the comprehensive table, provide:
   A. A calculation of total time certified in each capacity category (no capacity, alternative duties, etc.)
   B. Analysis of any gaps or overlaps in certificate coverage
   C. Summary of how the certified diagnosis evolved over time
   D. Pattern analysis of restriction changes and review periods

SPECIFIC REQUIREMENTS:
- Never make generic statements, only ones specific to this patients case. For instance the doctor reading this has substantial clinical knowledge to support their understanding and it is unhelpful to make basic statements about meaning which they easily know in their context..
- Ensure that there is longer length given to columns which would necessitate it. For instance for Name, it is typical that a name is longer than just 4 characters so this should give apporpriate space. 
- All dates must be in DD/MM/YYYY format
- For "Provider" column, include only the provider's name without their title
- For "Specialty" column, include only their medical specialty, use shorthand where appropriate e.g. Ortho, Plastics, Psychology, Psychiatry, GP, Physio, Exercise Physiologist, Occupational Therapist (so shortened only where posisble while retaining clarity)
- For "Citation" column, use the citation to the vector store, not document titles or filenames
- "Period Covered" must specify the exact date range the certificate covers
- "Diagnosed Condition" must quote the exact condition as written on the certificate
- "Work Capacity" must categorize the status (e.g., "Unfit," "Alternative Duties," "Full Capacity")
- "Specific Restrictions" must list all restrictions exactly as written
- "Next Review" must note the scheduled reassessment date
- Include ALL certificates chronologically regardless of issuing provider
- Highlight any changes in diagnosis or capacity between consecutive certificates
- Note any certificates issued retrospectively or covering past periods
- Identify any periods without certificate coverage
- Document instances of overlapping certificates from different providers
- Pay special attention to differences in work capacity assessment between providers
- Note any trends in certification duration (e.g., lengthening or shortening periods)
- Highlight any certificates where the provider noted factors delaying recovery
- Include certificates for Reduced hours/modified duties, but note Fitness

This WorkCover certification analysis directly relates to compensation entitlement under the workers' compensation system, particularly regarding weekly payments under Division 2 of the Workers' Compensation and Injury Management Act 1981 (WA).

YOUR MOST CRITICAL INSTRUCTION - EVERYTHING MUST HAVE CITATIONS TO THE DOCUMENTS YOU RETRIEVE FROM THE VECTOR STORE`
    },
    {
      id: 'independent-examinations',
      category: 'legal-aspects',
      summary: 'Independent medical examinations',
      fullQuery: 'Summarize all Independent Medical Examinations (IMEs) conducted.',
      enhancedPrompt: `Identify and analyze all independent medical examinations (IMEs) and medicolegal assessments conducted for this claim. Compare their findings, opinions, and conclusions with treating provider assessments.

FORMAT YOUR RESPONSE AS FOLLOWS:
1. Begin with an executive summary (no header , just dot points) of all IMEs performed and their general alignment or divergence.
2. Create a chronological table with these exact columns:
   | Date | Examiner | Specialty | Requesting Party | Diagnosis | Causation Opinion | Work Capacity | Prognosis | Key Differences from Treating View | Citation |

3. For each IME, provide a detailed section with:
   A. Examination Context: Purpose, scope, and materials reviewed
   B. Key Findings: Major clinical observations and test results
   C. Critical Opinions: Core conclusions on diagnosis, causation, and capacity
   D. Comparison with Treating Providers: Areas of agreement and disagreement

SPECIFIC REQUIREMENTS:
- Never make generic statements, only ones specific to this patients case. For instance the doctor reading this has substantial clinical knowledge to support their understanding and it is unhelpful to make basic statements about meaning which they easily know in their context..
- Ensure that there is longer length given to columns which would necessitate it. For instance for Name, it is typical that a name is longer than just 4 characters so this should give apporpriate space. 
- All dates must be in DD/MM/YYYY format
- For "Examiner" column, include only the provider's name without their title
- For "Specialty" column, include only their medical specialty, use shorthand where appropriate e.g. Ortho, Plastics, Psychology, Psychiatry, GP, Physio, Exercise Physiologist, Occupational Therapist (so shortened only where posisble while retaining clarity)
- For "Citation" column, use the citation to the vector store, not document titles or filenames
- "Requesting Party" must identify who commissioned the IME (e.g., insurer, employer, regulator)
- "Diagnosis" must state the examiner's diagnostic conclusion
- "Causation Opinion" must summarize the relationship between the incident and condition
- "Work Capacity" must detail both current and future capacity determinations
- "Key Differences" must highlight major divergences from treating provider opinions
- Include only formal independent assessments, not treating provider evaluations
- Note the scope and completeness of each examination
- Document what records and information were available to each examiner
- Highlight any factual errors or misinterpretations identified in IME reports
- Note whether treating providers have responded to or rebutted IME findings
- Compare IME findings with objective clinical evidence in the file
- Pay special attention to how different IMEs handled the same clinical information
- Document whether IME conclusions have influenced claim decisions or treatment approvals

This IME analysis is critical for evaluating the medical evidence in contested workers' compensation and motor vehicle accident claims, particularly in relation to both the Workers' Compensation and Injury Management Act 1981 (WA) requirements for medical evidence and the Motor Vehicle (Third Party Insurance) Act 1943 (WA) assessment frameworks.

YOUR MOST CRITICAL INSTRUCTION - EVERYTHING MUST HAVE CITATIONS TO THE DOCUMENTS YOU RETRIEVE FROM THE VECTOR STORE`
    },
    {
      id: 'treatment-approvals',
      category: 'legal-aspects',
      summary: 'Treatment approval status',
      fullQuery: 'Compile all WorkCover treatment approvals, rejections, and pending requests.',
      enhancedPrompt: `Document all treatment authorizations, approvals, denials, and pending requests within the compensation system. Track the timeline of requests, decisions, and the impact of any delays or denials on the patient's recovery.

FORMAT YOUR RESPONSE AS FOLLOWS:
1. 1. Begin with an executive summary (Do not write the title 'Executive summary', just do dot points)  of the overall treatment approval pattern and current status.
2. Create a chronological table with these exact columns:
   | Date Requested | Treatment | Requesting Provider | Specialty | Decision Date | Decision | Reason Given | Impact on Recovery | Citation |

3. After the comprehensive table, organize treatments into categories:
   A. Approved Treatments
   B. Rejected Treatments
   C. Partially Approved Treatments
   D. Pending Decisions
   E. Treatments Approved After Initial Rejection

SPECIFIC REQUIREMENTS:
- Never make generic statements, only ones specific to this patients case. For instance the doctor reading this has substantial clinical knowledge to support their understanding and it is unhelpful to make basic statements about meaning which they easily know in their context..
- Ensure that there is longer length given to columns which would necessitate it. For instance for Name, it is typical that a name is longer than just 4 characters so this should give apporpriate space. 
- All dates must be in DD/MM/YYYY format
- For "Requesting Provider" column, include only the provider's name without their title
- For "Specialty" column, include only their medical specialty, use shorthand where appropriate e.g. Ortho, Plastics, Psychology, Psychiatry, GP, Physio, Exercise Physiologist, Occupational Therapist (so shortened only where posisble while retaining clarity)
- For "Citation" column, use the citation to the vector store, not document titles or filenames
- "Treatment" must specify the exact intervention requested
- "Decision" must categorize the outcome (e.g., "Approved," "Denied," "Partially Approved")
- "Reason Given" must summarize the stated rationale for the decision
- "Impact on Recovery" must document any provider comments about how the decision affected recovery
- Calculate the average time between request and decision for approved and denied treatments
- Highlight treatments with significant delays between request and decision
- Note any appeals or reviews of denied treatments and their outcomes
- Document provider comments about the medical necessity of requested treatments
- Pay special attention to cases where providers modified treatment due to approval issues
- Note whether alternative treatments were offered when requested treatments were denied
- Include information about whether the patient proceeded with denied treatments at their own expense
- Highlight any treatment denials that providers explicitly linked to delayed recovery

This treatment approval analysis is directly relevant to the "reasonable medical expenses" provisions under s.18 of the Workers' Compensation and Injury Management Act 1981 (WA) and the determination of necessary and reasonable medical treatment in motor vehicle accident claims.

YOUR MOST CRITICAL INSTRUCTION - EVERYTHING MUST HAVE CITATIONS TO THE DOCUMENTS YOU RETRIEVE FROM THE VECTOR STORE`
    },
    {
      id: 'surveillance-references',
      category: 'legal-aspects',
      summary: 'Surveillance information',
      fullQuery: 'Are there references to surveillance or investigator findings in the records?',
      enhancedPrompt: `Identify all references to surveillance, investigation reports, social media monitoring, or other external observations of the patient's activities. Document how this information was incorporated into medical opinions and assessments.

FORMAT YOUR RESPONSE AS FOLLOWS:
1. Begin with a statement about whether surveillance evidence is mentioned in the records.
2. If surveillance is referenced, create a table with these exact columns:
   | Date of Reference | Provider | Specialty | Surveillance Type/Date | Activities Observed | Provider's Interpretation | Impact on Opinion | Citation |

3. If surveillance is referenced, provide:
   A. Analysis of how providers incorporated surveillance findings into their assessment
   B. Comparison of surveilled activities with reported limitations
   C. Impact of surveillance on diagnosis, causation, or capacity determinations

SPECIFIC REQUIREMENTS:
- Never make generic statements, only ones specific to this patients case. For instance the doctor reading this has substantial clinical knowledge to support their understanding and it is unhelpful to make basic statements about meaning which they easily know in their context..
- Ensure that there is longer length given to columns which would necessitate it. For instance for Name, it is typical that a name is longer than just 4 characters so this should give apporpriate space. 
- All dates must be in DD/MM/YYYY format
- For "Provider" column, include only the provider's name without their title
- For "Specialty" column, include only their medical specialty, use shorthand where appropriate e.g. Ortho, Plastics, Psychology, Psychiatry, GP, Physio, Exercise Physiologist, Occupational Therapist (so shortened only where posisble while retaining clarity)
- For "Citation" column, use the citation to the vector store, not document titles or filenames
- "Surveillance Type/Date" must specify the nature and timing of the observation
- "Activities Observed" must summarize what was reportedly witnessed
- "Provider's Interpretation" must document how the provider contextualized the observations
- "Impact on Opinion" must note whether and how the surveillance changed the provider's assessment
- Include all references to surveillance, investigations, or similar external observations
- Note whether the actual surveillance materials were reviewed or just described
- Document whether the patient was given an opportunity to respond to surveillance findings
- Highlight any discrepancies noted between surveilled activities and reported limitations
- Note whether providers found the surveillance to be consistent or inconsistent with clinical findings
- Pay special attention to how surveillance influenced formal capacity assessments
- Include information about the timing of surveillance relative to reported symptom fluctuations
- Note any provider comments about the limitations or context of surveillance evidence

This surveillance reference analysis is relevant to credibility assessment in both workers' compensation and motor vehicle accident claims, particularly in cases where symptom magnification or misrepresentation is alleged.`
    },
    
    // MVA-Specific Queries
    {
      id: 'mva-immediate-symptoms',
      category: 'mva-specific',
      summary: 'Post-MVA immediate symptoms',
      fullQuery: 'Compile all documentation regarding symptoms in the immediate aftermath of the MVA.',
      enhancedPrompt: `Identify and analyze all documentation of symptoms, injuries, and clinical findings in the immediate aftermath of the motor vehicle accident. Focus on the evolution of symptoms from the accident scene through the first week post-accident.

FORMAT YOUR RESPONSE AS FOLLOWS:
1. 1. Begin with an executive summary (Do not write the title 'Executive summary', just do dot points)  of the immediate post-accident presentation and documentation sources.
2. Create a detailed chronological table with these exact columns:
   | Timepoint | Source Type | Provider | Specialty | Provider/Witness | Documented Symptoms | Physical Findings | Treatment Provided | Citation |

3. Organize the immediate post-accident period into these specific timeframes:
   A. At Scene / Ambulance (if applicable)
   B. Emergency Department / Initial Assessment (if applicable)
   C. First 24 Hours Post-Accident
   D. 24-72 Hours Post-Accident
   E. 3-7 Days Post-Accident

SPECIFIC REQUIREMENTS:
- Never make generic statements, only ones specific to this patients case. For instance the doctor reading this has substantial clinical knowledge to support their understanding and it is unhelpful to make basic statements about meaning which they easily know in their context..
- Ensure that there is longer length given to columns which would necessitate it. For instance for Name, it is typical that a name is longer than just 4 characters so this should give apporpriate space. 
- All dates must be in DD/MM/YYYY format
- For "Provider" and "Provider/Witness" columns, include only the provider's or witness's name without their title
- For "Specialty" column, include only their medical specialty, use shorthand where appropriate e.g. Ortho, Plastics, Psychology, Psychiatry, GP, Physio, Exercise Physiologist, Occupational Therapist (so shortened only where posisble while retaining clarity)
- For "Citation" column, use the citation to the vector store, not document titles or filenames
- "Timepoint" must specify the exact time interval since the accident
- "Source Type" must categorize the documentation (e.g., "Ambulance Record," "ED Notes," "GP Visit")
- "Documented Symptoms" must list all reported symptoms and complaints
- "Physical Findings" must include only objective clinical observations
- "Treatment Provided" must summarize any interventions administered
- Include both medical and non-medical sources (e.g., police report, witness statements)
- Document the exact timing of the first medical assessment post-accident
- Highlight any symptoms that emerged after a delay rather than immediately
- Note the evolution and progression of symptoms during this early period
- Pay special attention to any discrepancies between different accounts of early symptoms
- Include information about the accident mechanism as described in early records
- Note whether post-traumatic stress or psychological symptoms were present initially
- Document any clinical comments about the consistency between mechanism and symptoms

This immediate post-MVA symptom analysis is crucial for causation determination in motor vehicle accident claims, particularly regarding the development of conditions like whiplash associated disorder (WAD) under the Motor Vehicle (Third Party Insurance) Act 1943 (WA) framework.

YOUR MOST CRITICAL INSTRUCTION - EVERYTHING MUST HAVE CITATIONS TO THE DOCUMENTS YOU RETRIEVE FROM THE VECTOR STORE`
    },
    {
      id: 'whiplash-grading',
      category: 'mva-specific',
      summary: 'Whiplash classification',
      fullQuery: 'Track all Whiplash Associated Disorder (WAD) grading assessments following the MVA.',
      enhancedPrompt: `Identify all clinical assessments of Whiplash Associated Disorder (WAD) following the motor vehicle accident. Track the WAD grading and classification over time, noting any progression or regression in severity.

FORMAT YOUR RESPONSE AS FOLLOWS:
1. 1. Begin with an executive summary (Do not write the title 'Executive summary', just do dot points)  of the WAD diagnosis pattern and current status.
2. Create a chronological table with these exact columns:
   | Date | Provider | Specialty | WAD Grade (0-IV) | Diagnostic Criteria Referenced | Key Symptoms/Findings | Prognosis | Citation |

3. After the comprehensive table, provide:
   A. Analysis of any changes in WAD grading over time
   B. Summary of providers' explanations for WAD grade assignments
   C. Comparison with standard WAD diagnostic criteria and classification

SPECIFIC REQUIREMENTS:
- Never make generic statements, only ones specific to this patients case. For instance the doctor reading this has substantial clinical knowledge to support their understanding and it is unhelpful to make basic statements about meaning which they easily know in their context..
- Ensure that there is longer length given to columns which would necessitate it. For instance for Name, it is typical that a name is longer than just 4 characters so this should give apporpriate space. 
- All dates must be in DD/MM/YYYY format
- For "Provider" column, include only the provider's name without their title
- For "Specialty" column, include only their medical specialty, use shorthand where appropriate e.g. Ortho, Plastics, Psychology, Psychiatry, GP, Physio, Exercise Physiologist, Occupational Therapist (so shortened only where posisble while retaining clarity)
- For "Citation" column, use the citation to the vector store, not document titles or filenames
- "WAD Grade" must specify the exact numerical grade assigned (0, I, II, III, or IV)
- "Diagnostic Criteria Referenced" must note what classification system was used (e.g., "QTF," "SIRA")
- "Key Symptoms/Findings" must list the clinical elements supporting the classification
- "Prognosis" must include the provider's prediction for recovery based on WAD grade
- Include only explicit WAD assessments and classifications, not general neck pain references
- Note whether each assessment followed standard classification methodology
- Document how diagnostic imaging influenced WAD classification decisions
- Highlight any discrepancies between different providers' WAD grading
- Pay special attention to progression between grades or plateau at a specific grade
- Note any provider comments about factors influencing recovery from the WAD condition
- Include information about how WAD classification informed treatment decisions
- Document any associations made between WAD grade and expected disability duration

This WAD grading analysis is essential for assessment under the motor vehicle injury compensation framework in Western Australia, particularly in relation to the Motor Vehicle (Third Party Insurance) Act 1943 (WA) and the frequently applied Quebec Task Force (QTF) WAD classification system.

YOUR MOST CRITICAL INSTRUCTION - EVERYTHING MUST HAVE CITATIONS TO THE DOCUMENTS YOU RETRIEVE FROM THE VECTOR STORE`
    },
    {
      id: 'third-party-assessments',
      category: 'mva-specific',
      summary: 'Insurance medical assessments',
      fullQuery: 'Extract all third-party/casualty insurer medical assessment results.',
      enhancedPrompt: `Identify and analyze all medical assessments commissioned by third-party/casualty insurers following the motor vehicle accident. Focus on how these assessments addressed causation, impairment, and prognosis within the motor vehicle compensation framework.

FORMAT YOUR RESPONSE AS FOLLOWS:
1. Begin with an executive summary (no header , just dot points) of all third-party insurer assessments and their general alignment.
2. Create a detailed table with these exact columns:
   | Date | Examiner | Specialty | Requesting Insurer | Diagnosis | Causation Determination | Impairment Assessment | Treatment Recommendations | Return to Normal | Citation |

3. For each third-party assessment, provide a detailed section with:
   A. Examination Context: Timing, scope, and materials reviewed
   B. Key Clinical Findings: Major observations and test results
   C. Threshold Determinations: Assessments related to compensation thresholds
   D. Comparison with Treating Opinions: Areas of agreement and disagreement

SPECIFIC REQUIREMENTS:
- Never make generic statements, only ones specific to this patients case. For instance the doctor reading this has substantial clinical knowledge to support their understanding and it is unhelpful to make basic statements about meaning which they easily know in their context..
- Ensure that there is longer length given to columns which would necessitate it. For instance for Name, it is typical that a name is longer than just 4 characters so this should give apporpriate space. 
- All dates must be in DD/MM/YYYY format
- For "Examiner" column, include only the provider's name without their title
- For "Specialty" column, include only their medical specialty, use shorthand where appropriate e.g. Ortho, Plastics, Psychology, Psychiatry, GP, Physio, Exercise Physiologist, Occupational Therapist (so shortened only where posisble while retaining clarity)
- For "Citation" column, use the citation to the vector store, not document titles or filenames
- "Causation Determination" must summarize the relationship established between the MVA and condition
- "Impairment Assessment" must include any formal ratings or threshold determinations
- "Treatment Recommendations" must note what further care was advised
- "Return to Normal" must document the examiner's prognosis for recovery
- Include only assessments commissioned specifically by motor vehicle insurers
- Note any statutory framework or guidelines specifically referenced in the assessment
- Document whether "minor injury" definitions or thresholds were addressed
- Highlight any determinations regarding "narrative causation" or "material contribution"
- Pay special attention to assessments of pre-existing conditions versus accident-related pathology
- Note any commentary on whether treatment has been reasonable and necessary
- Include information about whole person impairment (WPI) assessments if conducted
- Document how these assessments influenced claim decisions or settlement offers

This analysis of third-party medical assessments is directly relevant to claim determination under the Motor Vehicle (Third Party Insurance) Act 1943 (WA) and the assessment frameworks established by the Insurance Commission of Western Australia (ICWA) for motor vehicle accident claims.`
    }
  ];
  
  /**
   * Client-side representation of predefined queries (excludes server-side prompts)
   */
  export interface ClientPredefinedQuery {
    id: string
    category: string
    summary: string
    fullQuery: string
  }
  
  /**
   * Get the client-safe version of predefined queries
   */
  export function getClientPredefinedQueries(): ClientPredefinedQuery[] {
    return PREDEFINED_QUERIES.map(({ id, category, summary, fullQuery }) => ({
      id,
      category,
      summary,
      fullQuery
    }))
  }
  
  /**
   * Find the enhanced prompt for a given query text
   * @param queryText The full query text to match
   * @returns The enhanced prompt if found, undefined otherwise
   */
  export function findEnhancedPrompt(queryText: string): string | undefined {
    const normalizedQuery = queryText.trim().toLowerCase()
    
    const match = PREDEFINED_QUERIES.find(
      query => query.fullQuery.toLowerCase().trim() === normalizedQuery || 
               query.summary.toLowerCase().trim() === normalizedQuery
    )
    
    return match?.enhancedPrompt
  }