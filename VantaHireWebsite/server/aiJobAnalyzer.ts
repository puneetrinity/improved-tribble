import { getGroqClient, isGroqConfigured } from './lib/groqClient';
import {
  JobAnalysisResponseSchema,
  EmailDraftResponseSchema,
  CandidateSummaryResponseSchema,
  PipelineActionsResponseSchema,
  FormQuestionsResponseSchema,
  safeParseAiResponse,
} from './lib/aiResponseSchemas';

// Check if AI features are available
export function isAIEnabled(): boolean {
  return isGroqConfigured();
}

export interface JobAnalysisResult {
  clarity_score: number;
  inclusion_score: number;
  seo_score: number;
  overall_score: number;
  bias_flags: string[];
  seo_keywords: string[];
  suggestions: string[];
  rewrite: string;
  model_version: string;
}

export async function analyzeJobDescription(title: string, description: string): Promise<JobAnalysisResult> {
  try {
    const client = getGroqClient();
    const prompt = `Evaluate the following job description for clarity, inclusion, and SEO optimization. Provide specific, actionable feedback AND a fully rewritten, optimized version.

Job Title: ${title}
Job Description: ${description}

Analyze and return a JSON object with:
- clarity_score (0-100): How clear and well-structured the description is
- inclusion_score (0-100): How inclusive and bias-free the language is
- seo_score (0-100): How well optimized for search engines
- overall_score (0-100): Average of the three scores
- bias_flags (array): Specific biased terms or phrases found
- seo_keywords (array): Important missing keywords that should be added
- suggestions (array): Specific improvement recommendations
- rewrite (string): A complete, optimized rewrite of the job description that addresses all identified issues and maximizes clarity, inclusion, and SEO

Focus on:
1. Clarity: Clear requirements, structured information, professional tone
2. Inclusion: Gender-neutral language, avoiding age/culture bias, accessible language
3. SEO: Industry keywords, location terms, skill-specific terminology

For the rewrite:
- Preserve ALL original job requirements, responsibilities, and qualifications
- Output as PLAIN TEXT (not JSON), using markdown-style headers like "## About the Role", "## Responsibilities", etc.
- Use gender-neutral language throughout (they/them, "you will", avoid gendered terms)
- Include relevant industry keywords naturally
- Make it scannable with bullet points (use - or * for lists)
- Keep professional but engaging tone
- Do NOT include JSON keys like {"About the Role": ...} - output readable text only

Return only valid JSON without any additional text.`;

    const response = await client.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content: "You are an expert HR consultant specializing in job description optimization. Provide detailed, actionable feedback in valid JSON format only."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      response_format: { type: "json_object" },
      max_tokens: 2000,
      temperature: 0.3
    });

    const responseText = response.choices[0]?.message.content || "{}";
    const result = safeParseAiResponse(JobAnalysisResponseSchema, responseText, 'job-analysis');

    return {
      clarity_score: Math.max(0, Math.min(100, result.clarity_score ?? 50)),
      inclusion_score: Math.max(0, Math.min(100, result.inclusion_score ?? 50)),
      seo_score: Math.max(0, Math.min(100, result.seo_score ?? 50)),
      overall_score: Math.max(0, Math.min(100, result.overall_score ?? 50)),
      bias_flags: result.bias_flags ?? [],
      seo_keywords: result.seo_keywords ?? [],
      suggestions: result.suggestions ?? [],
      rewrite: result.rewrite ?? '',
      model_version: "llama-3.3-70b-versatile"
    };

  } catch (error) {
    console.error('Groq API error:', error);
    if (error instanceof Error) {
      throw new Error(`AI analysis unavailable: ${error.message}`);
    }
    throw new Error('AI analysis failed');
  }
}

export async function generateJobScore(
  title: string, 
  description: string, 
  historicalData?: { averageViews: number; averageConversion: number }
): Promise<number> {
  try {
    const analysis = await analyzeJobDescription(title, description);
    
    // Base score from AI analysis (70% weight)
    let score = analysis.overall_score * 0.7;
    
    // Historical performance factor (30% weight if available)
    if (historicalData) {
      const performanceFactor = Math.min(100, 
        (historicalData.averageViews / 50) * 20 + 
        (historicalData.averageConversion) * 2
      );
      score += performanceFactor * 0.3;
    } else {
      // If no historical data, give more weight to AI analysis
      score = analysis.overall_score;
    }
    
    return Math.round(Math.max(0, Math.min(100, score)));
  } catch (error) {
    console.error('Job scoring error:', error);
    return 0;
  }
}

export function calculateOptimizationSuggestions(analysis: JobAnalysisResult): string[] {
  const suggestions: string[] = [...analysis.suggestions];

  if (analysis.clarity_score < 70) {
    suggestions.push("Consider restructuring with clear sections: Overview, Requirements, Benefits");
  }

  if (analysis.inclusion_score < 80) {
    suggestions.push("Review language for gender-neutral terms and inclusive phrasing");
  }

  if (analysis.seo_score < 70) {
    suggestions.push("Add more industry-specific keywords and location terms");
  }

  if (analysis.bias_flags.length > 0) {
    suggestions.push(`Address flagged terms: ${analysis.bias_flags.join(", ")}`);
  }

  return suggestions.slice(0, 10); // Limit to top 10 suggestions
}

export interface CandidateSummaryResult {
  summary: string;
  suggestedAction: 'advance' | 'hold' | 'reject';
  suggestedActionReason: string;
  strengths: string[];
  concerns: string[];
  keyHighlights: string[];
  // Skill analysis
  requiredSkillsMatched: string[];
  requiredSkillsMissing: string[];
  requiredSkillsMatchPercentage: number;
  requiredSkillsDepthNotes: string;
  goodToHaveSkillsMatched: string[];
  goodToHaveSkillsMissing: string[];
  model_version: string;
  tokensUsed: {
    input: number;
    output: number;
  };
}

/**
 * Generate an AI-powered summary of a candidate's fit for a specific job
 *
 * @param resumeText - Extracted text from the candidate's resume
 * @param jobTitle - Title of the job position
 * @param jobDescription - Full job description
 * @param candidateName - Name of the candidate for personalization
 * @returns Structured summary with actionable recommendations
 */
export interface EmailDraftResult {
  subject: string;
  body: string;
  model_version: string;
  tokensUsed: {
    input: number;
    output: number;
  };
}

export interface ColdOutreachDraftInput {
  job: {
    title: string;
    description: string;
    location?: string | null;
    salaryMin?: number | null;
    salaryMax?: number | null;
    salaryPeriod?: string | null;
    requirements?: string[];
    companyName: string;
    publicJobUrl: string;
  };
  candidate: {
    name: string;
    headline?: string | null;
    summary?: string | null;
    currentRole?: string | null;
    skills?: string[];
    location?: string | null;
  };
  recruiter: {
    name: string;
    email: string;
  };
  tone?: 'friendly' | 'formal';
  extraContext?: string;
}

export async function generateEmailDraft(
  templateSubject: string,
  templateBody: string,
  candidateName: string,
  candidateEmail: string,
  jobTitle: string,
  companyName: string,
  tone: 'friendly' | 'formal' = 'friendly'
): Promise<EmailDraftResult> {
  try {
    const client = getGroqClient();

    const toneGuidance = tone === 'friendly'
      ? "Use a warm, conversational tone while maintaining professionalism. Be personable and engaging."
      : "Use a formal, professional tone. Be respectful and business-appropriate.";

    const prompt = `You are a professional recruiter drafting a personalized email to a candidate.

**Template Subject:** ${templateSubject}
**Template Body:** ${templateBody}

**Candidate Details:**
- Name: ${candidateName}
- Email: ${candidateEmail}
- Applied for: ${jobTitle}
- Company: ${companyName}

**Tone:** ${toneGuidance}

Your task:
1. Personalize the email template for this specific candidate
2. Replace any placeholders like [Candidate Name], [Job Title], [Company Name] with actual values
3. Enhance the message to be more engaging and specific to the role
4. Keep the core message and structure from the template
5. Ensure proper formatting with line breaks for readability

Return a JSON object with:
- **subject** (string): A personalized, compelling subject line (40-60 characters)
- **body** (string): The personalized email body with proper formatting. Use \\n\\n for paragraph breaks.

Return only valid JSON.`;

    const response = await client.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content: "You are an expert recruiter who writes engaging, personalized emails to candidates. Always return valid JSON format only."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      response_format: { type: "json_object" },
      max_tokens: 1000,
      temperature: 0.6
    });

    const responseText = response.choices[0]?.message.content || "{}";
    const result = safeParseAiResponse(EmailDraftResponseSchema, responseText, 'email-draft');
    const usage = response.usage;

    return {
      subject: result.subject || templateSubject,
      body: result.body || templateBody,
      model_version: "llama-3.3-70b-versatile",
      tokensUsed: {
        input: usage?.prompt_tokens || 0,
        output: usage?.completion_tokens || 0
      }
    };

  } catch (error) {
    console.error('Groq API error during email draft generation:', error);
    if (error instanceof Error) {
      throw new Error(`AI email draft unavailable: ${error.message}`);
    }
    throw new Error('AI email draft failed');
  }
}

export async function generateColdOutreachDraft(
  input: ColdOutreachDraftInput,
): Promise<EmailDraftResult> {
  try {
    const client = getGroqClient();
    const toneGuidance = input.tone === 'formal'
      ? 'Use a concise, polished, professional tone.'
      : 'Use a warm, confident, recruiter-friendly tone.';

    const prompt = `You are writing a personalized cold outreach email to a sourced candidate for a job opening.

Job:
- Title: ${input.job.title}
- Company: ${input.job.companyName}
- Location: ${input.job.location ?? 'Not specified'}
- Salary: ${input.job.salaryMin != null || input.job.salaryMax != null
    ? `${input.job.salaryMin ?? 'N/A'} - ${input.job.salaryMax ?? 'N/A'} ${input.job.salaryPeriod ?? ''}`.trim()
    : 'Not specified'}
- Requirements: ${(input.job.requirements ?? []).slice(0, 8).join(', ') || 'Not specified'}
- Description: ${input.job.description}
- Application URL: ${input.job.publicJobUrl}

Candidate:
- Name: ${input.candidate.name}
- Headline: ${input.candidate.headline ?? 'Not provided'}
- Current role: ${input.candidate.currentRole ?? 'Not provided'}
- Location: ${input.candidate.location ?? 'Not provided'}
- Skills: ${(input.candidate.skills ?? []).slice(0, 10).join(', ') || 'Not provided'}
- Summary: ${input.candidate.summary ?? 'Not provided'}

Recruiter:
- Name: ${input.recruiter.name}
- Email: ${input.recruiter.email}

Tone: ${toneGuidance}
Extra context: ${input.extraContext?.trim() || 'None'}

Instructions:
1. Personalize the opening with one concrete candidate detail.
2. Mention the job title and company.
3. Explain why the role may be relevant.
4. Keep the body between 80 and 150 words.
5. End with a clear CTA that asks them to apply using the provided application URL.
6. Sign off with the recruiter name only.
7. Subject line must be concrete and 35-60 characters.

Return valid JSON only with:
- subject
- body`;

    const response = await client.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content: 'You are an expert recruiter writing concise personalized cold outreach emails. Return valid JSON only.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 700,
      temperature: 0.6,
    });

    const responseText = response.choices[0]?.message.content || '{}';
    const result = safeParseAiResponse(EmailDraftResponseSchema, responseText, 'cold-outreach-draft');
    const usage = response.usage;

    return {
      subject: result.subject,
      body: result.body,
      model_version: 'llama-3.3-70b-versatile',
      tokensUsed: {
        input: usage?.prompt_tokens || 0,
        output: usage?.completion_tokens || 0,
      },
    };
  } catch (error) {
    console.error('Groq API error during cold outreach draft generation:', error);
    if (error instanceof Error) {
      throw new Error(`AI cold outreach draft unavailable: ${error.message}`);
    }
    throw new Error('AI cold outreach draft failed');
  }
}

export async function generateCandidateSummary(
  resumeText: string,
  jobTitle: string,
  jobDescription: string,
  candidateName: string,
  requiredSkills: string[] = [],
  goodToHaveSkills: string[] = []
): Promise<CandidateSummaryResult> {
  try {
    const client = getGroqClient();

    const prompt = `You are an expert technical recruiter reviewing a candidate for a position. Evaluate with STRICT attention to required vs. optional skills.

**Job Position:** ${jobTitle}

**🔴 REQUIRED SKILLS (Non-negotiable):**
${requiredSkills.length > 0 ? requiredSkills.join(', ') : 'Not specified'}

**🟢 GOOD-TO-HAVE SKILLS (Bonus, not mandatory):**
${goodToHaveSkills.length > 0 ? goodToHaveSkills.join(', ') : 'Not specified'}

**Job Description:**
${jobDescription}

**Candidate:** ${candidateName}
**Resume:**
${resumeText}

**EVALUATION CRITERIA:**

1. **Required Skills Analysis:**
   - Each required skill MUST be evaluated individually
   - Missing required skills should heavily influence your decision
   - Consider depth of experience, not just keyword presence
   - Look for semantic equivalents (e.g., "PostgreSQL" counts for "SQL", "Go" for "Golang")
   - Assess quality: is it just mentioned or demonstrated with projects/years of experience?

2. **Decision Guidelines:**
   - ADVANCE: Has ALL or nearly all required skills with strong depth
   - HOLD: Missing 1-2 required skills BUT shows potential to learn quickly, OR has required skills but limited depth
   - REJECT: Missing multiple required skills with no transferable experience

3. **Good-to-Have Skills:**
   - These are bonuses that can tip borderline candidates toward "advance"
   - Should NOT compensate for missing required skills

**Required JSON Response:**
{
  "summary": "150-250 word comprehensive overview of the candidate's fit",

  "requiredSkillsAnalysis": {
    "matched": ["skill1", "skill2"],  // Required skills found in resume
    "missing": ["skill3"],             // Required skills NOT found
    "matchPercentage": 67,             // Percentage of required skills matched (0-100)
    "depthNotes": "Brief notes on depth/quality of matched skills (e.g., '5+ years Python with production experience')"
  },

  "goodToHaveSkillsAnalysis": {
    "matched": ["bonus1"],  // Good-to-have skills found
    "missing": ["bonus2"]   // Good-to-have skills NOT found
  },

  "suggestedAction": "advance|hold|reject",

  "suggestedActionReason": "Clear reasoning focusing on required skills match/gaps and why this action makes sense (100-150 words)",

  "strengths": ["specific strength 1", "specific strength 2", ...],  // 3-5 items

  "concerns": ["specific concern 1", "specific concern 2", ...],  // 0-3 items

  "keyHighlights": ["achievement 1", "achievement 2", ...]  // 3-5 items
}

Be objective, specific, and actionable. Focus on job-relevant qualifications. Return only valid JSON.`;

    const response = await client.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content: "You are an expert technical recruiter with deep experience evaluating candidates across various technical roles. Provide detailed, objective, and actionable assessments in valid JSON format only."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      response_format: { type: "json_object" },
      max_tokens: 2000,
      temperature: 0.3
    });

    const responseText = response.choices[0]?.message.content || "{}";
    const result = safeParseAiResponse(CandidateSummaryResponseSchema, responseText, 'candidate-summary');
    const usage = response.usage;

    return {
      summary: result.summary || "No summary generated",
      suggestedAction: result.suggestedAction ?? 'hold',
      suggestedActionReason: result.suggestedActionReason || "Requires further evaluation",
      strengths: result.strengths ?? [],
      concerns: result.concerns ?? [],
      keyHighlights: result.keyHighlights ?? [],
      // Skill analysis
      requiredSkillsMatched: result.requiredSkillsAnalysis?.matched ?? [],
      requiredSkillsMissing: result.requiredSkillsAnalysis?.missing ?? [],
      requiredSkillsMatchPercentage: result.requiredSkillsAnalysis?.matchPercentage ?? 0,
      requiredSkillsDepthNotes: result.requiredSkillsAnalysis?.depthNotes ?? '',
      goodToHaveSkillsMatched: result.goodToHaveSkillsAnalysis?.matched ?? [],
      goodToHaveSkillsMissing: result.goodToHaveSkillsAnalysis?.missing ?? [],
      model_version: "llama-3.3-70b-versatile",
      tokensUsed: {
        input: usage?.prompt_tokens || 0,
        output: usage?.completion_tokens || 0
      }
    };

  } catch (error) {
    console.error('Groq API error during candidate summary generation:', error);
    if (error instanceof Error) {
      throw new Error(`AI summary generation unavailable: ${error.message}`);
    }
    throw new Error('AI summary generation failed');
  }
}

// ============= PIPELINE ACTION ENHANCEMENT =============

export interface PipelineActionEnhancement {
  itemId: string;
  description: string;  // AI-generated context/tips
  impact: string;       // Brief impact statement
}

export interface PipelineActionsResult {
  enhancements: PipelineActionEnhancement[];
  additionalInsights: string[];  // Overall pipeline insights
  model_version: string;
  tokensUsed: {
    input: number;
    output: number;
  };
}

/**
 * Enhance pipeline action items with AI-generated context
 *
 * @param items - Array of action items from the rule engine
 * @param pipelineStats - Overall pipeline health metrics
 * @returns Enhanced descriptions and insights
 */
export async function enhancePipelineActions(
  items: Array<{ id: string; title: string; priority: string; category: string }>,
  pipelineStats: { healthScore: number; totalCandidates: number; openJobs: number }
): Promise<PipelineActionsResult> {
  try {
    const client = getGroqClient();

    const itemsDescription = items.map((item, i) =>
      `${i + 1}. [${item.priority.toUpperCase()}] ${item.title} (Category: ${item.category})`
    ).join('\n');

    const prompt = `You are an expert recruiting operations advisor. Analyze these pipeline hygiene action items and provide helpful context.

**Current Pipeline Stats:**
- Health Score: ${pipelineStats.healthScore}%
- Total Active Candidates: ${pipelineStats.totalCandidates}
- Open Jobs: ${pipelineStats.openJobs}

**Action Items to Enhance:**
${itemsDescription}

For each action item, provide:
1. **description** (string, 1-2 sentences): Specific, actionable context explaining WHY this matters and a QUICK TIP for addressing it
2. **impact** (string, 5-10 words): Brief statement of the positive impact of completing this action

Also provide 1-2 **additionalInsights** about the overall pipeline health based on the patterns you see in these items.

Return a JSON object with:
- **enhancements** (array): For each input item (in order), an object with: itemId (string, use the exact id provided), description (string), impact (string)
- **additionalInsights** (array of strings, 1-2 items): Brief overall observations

Be specific, practical, and encouraging. Focus on recruiter best practices. Return only valid JSON.`;

    const response = await client.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content: "You are an expert recruiting operations advisor who helps recruiters optimize their pipeline. Provide specific, actionable advice in valid JSON format only."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      response_format: { type: "json_object" },
      max_tokens: 1500,
      temperature: 0.5
    });

    const responseText = response.choices[0]?.message.content || "{}";
    const result = safeParseAiResponse(PipelineActionsResponseSchema, responseText, 'pipeline-actions');
    const usage = response.usage;

    // Map enhancements to their item IDs (fall back to original item IDs)
    const enhancements: PipelineActionEnhancement[] = (result.enhancements ?? [])
      .slice(0, items.length)
      .map((enh, index) => ({
        itemId: enh.itemId || items[index]?.id || '',
        description: enh.description ?? '',
        impact: enh.impact ?? '',
      }))
      .filter(enh => enh.itemId);

    return {
      enhancements,
      additionalInsights: (result.additionalInsights ?? []).slice(0, 3),
      model_version: "llama-3.3-70b-versatile",
      tokensUsed: {
        input: usage?.prompt_tokens || 0,
        output: usage?.completion_tokens || 0
      }
    };

  } catch (error) {
    console.error('Groq API error during pipeline action enhancement:', error);
    if (error instanceof Error) {
      throw new Error(`AI pipeline enhancement unavailable: ${error.message}`);
    }
    throw new Error('AI pipeline enhancement failed');
  }
}

// ============= FORM FIELD SUGGESTIONS =============

export interface FormFieldSuggestion {
  label: string;
  description?: string;
  fieldType: 'short_text' | 'long_text' | 'yes_no' | 'select';
  required: boolean;
  options?: string[];
}

export interface FormQuestionsResult {
  fields: FormFieldSuggestion[];
  model_version: string;
  tokensUsed: {
    input: number;
    output: number;
  };
}

function normalizeAiQuestionType(fieldType: string | undefined): FormFieldSuggestion['fieldType'] {
  switch (fieldType) {
    case 'mcq':
    case 'scale':
      return 'select';
    case 'yes_no':
    case 'select':
    case 'short_text':
    case 'long_text':
      return fieldType;
    default:
      return 'long_text';
  }
}

function normalizeAiQuestionOptions(
  originalType: string | undefined,
  normalizedType: FormFieldSuggestion['fieldType'],
  options: string[] | undefined
): string[] | undefined {
  if (normalizedType !== 'select') {
    return undefined;
  }

  if (originalType === 'scale') {
    return options && options.length > 0 ? options : ['1', '2', '3', '4', '5'];
  }

  return options && options.length > 0 ? options : undefined;
}

/**
 * Generate AI-suggested screening questions for a job application form
 *
 * @param jobDescription - The job description text
 * @param skills - Array of required skills for the job
 * @param goals - Assessment goals (e.g., ["communication", "technical_depth", "culture_fit"])
 * @returns Structured form field suggestions
 */
export async function generateFormQuestions(
  jobDescription: string,
  skills: string[],
  goals: string[]
): Promise<FormQuestionsResult> {
  try {
    const client = getGroqClient();

    const goalsText = goals.length > 0
      ? goals.join(", ")
      : "general screening";

    const skillsText = skills.length > 0
      ? `Required skills: ${skills.join(", ")}`
      : "No specific skills listed";

    const prompt = `You are an expert HR consultant creating screening questions for job applications.

**Job Description:**
${jobDescription}

**${skillsText}**

**Assessment Goals:** ${goalsText}

Create 5-8 effective screening questions that help evaluate candidates for this role. Focus on:
1. **Communication**: Assess written communication and clarity
2. **Technical depth**: Evaluate relevant technical skills and experience
3. **Culture fit**: Understand work style, values, and motivations
4. **Role-specific**: Questions tailored to this specific job

For each question, provide:
- **label** (string): The question text (clear, specific, professional)
- **description** (string, optional): Additional context or instructions for the candidate
- **fieldType** (string): One of:
  - "short_text": For brief answers (name, URL, single sentence)
  - "long_text": For detailed answers (paragraphs, explanations)
  - "yes_no": For binary questions that need a yes/no answer
  - "select": For multiple choice or rating questions (provide options array)
- **required** (boolean): Whether this question is mandatory
- **options** (array of strings, only for select): The dropdown options

Return a JSON object with a "fields" array containing 5-8 questions. Make questions:
- Specific and actionable (not generic)
- Relevant to the job description and skills
- Progressive in difficulty (start easier, get more specific)
- Diverse in format (mix text, yes/no, and selects)

Return only valid JSON.`;

    const response = await client.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content: "You are an expert HR consultant who creates effective, job-specific screening questions. Always return valid JSON format only."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      response_format: { type: "json_object" },
      max_tokens: 1500,
      temperature: 0.5
    });

    const responseText = response.choices[0]?.message.content || "{}";
    const result = safeParseAiResponse(FormQuestionsResponseSchema, responseText, 'form-questions');
    const usage = response.usage;

    // Map validated fields to expected format
    const validatedFields: FormFieldSuggestion[] = (result.fields ?? []).map(field => {
      const normalizedType = normalizeAiQuestionType(field.fieldType);
      const base: FormFieldSuggestion = {
        label: field.label ?? 'Untitled Question',
        fieldType: normalizedType,
        required: field.required ?? false,
      };
      if (field.description) base.description = field.description;
      const normalizedOptions = normalizeAiQuestionOptions(field.fieldType, normalizedType, field.options);
      if (normalizedOptions) base.options = normalizedOptions;
      return base;
    });

    return {
      fields: validatedFields,
      model_version: "llama-3.3-70b-versatile",
      tokensUsed: {
        input: usage?.prompt_tokens || 0,
        output: usage?.completion_tokens || 0
      }
    };

  } catch (error) {
    console.error('Groq API error during form question generation:', error);
    if (error instanceof Error) {
      throw new Error(`AI form generation unavailable: ${error.message}`);
    }
    throw new Error('AI form generation failed');
  }
}
