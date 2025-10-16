import OpenAI from "openai";

// the newest OpenAI model is "gpt-4o" which was released May 13, 2024. do not change this unless explicitly requested by the user
let openai: OpenAI | null = null;

// Lazy initialization of OpenAI client
function getOpenAIClient(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OpenAI API key not configured. AI features are disabled.');
  }
  if (!openai) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

// Check if AI features are available
export function isAIEnabled(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

export interface JobAnalysisResult {
  clarity_score: number;
  inclusion_score: number;
  seo_score: number;
  overall_score: number;
  bias_flags: string[];
  seo_keywords: string[];
  suggestions: string[];
  model_version: string;
}

export async function analyzeJobDescription(title: string, description: string): Promise<JobAnalysisResult> {
  try {
    const client = getOpenAIClient();
    const prompt = `Evaluate the following job description for clarity, inclusion, and SEO optimization. Provide specific, actionable feedback.

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

Focus on:
1. Clarity: Clear requirements, structured information, professional tone
2. Inclusion: Gender-neutral language, avoiding age/culture bias, accessible language
3. SEO: Industry keywords, location terms, skill-specific terminology

Return only valid JSON without any additional text.`;

    const response = await client.chat.completions.create({
      model: "gpt-4o",
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
      max_tokens: 1000,
      temperature: 0.3
    });

    const result = JSON.parse(response.choices[0].message.content || "{}");

    // Validate and ensure all required fields exist
    return {
      clarity_score: Math.max(0, Math.min(100, result.clarity_score || 0)),
      inclusion_score: Math.max(0, Math.min(100, result.inclusion_score || 0)),
      seo_score: Math.max(0, Math.min(100, result.seo_score || 0)),
      overall_score: Math.max(0, Math.min(100, result.overall_score || 0)),
      bias_flags: Array.isArray(result.bias_flags) ? result.bias_flags : [],
      seo_keywords: Array.isArray(result.seo_keywords) ? result.seo_keywords : [],
      suggestions: Array.isArray(result.suggestions) ? result.suggestions : [],
      model_version: "gpt-4o"
    };

  } catch (error) {
    console.error('OpenAI API error:', error);
    if (error instanceof OpenAI.APIError) {
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