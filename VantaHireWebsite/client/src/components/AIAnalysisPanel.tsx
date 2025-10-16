import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { 
  Brain, 
  CheckCircle, 
  AlertTriangle, 
  TrendingUp, 
  Lightbulb,
  Target,
  Users,
  Search,
  Clock,
  Sparkles
} from "lucide-react";

interface AnalysisResult {
  clarity_score: number;
  inclusion_score: number;
  seo_score: number;
  overall_score: number;
  bias_flags: string[];
  seo_keywords: string[];
  suggestions: string[];
  model_version: string;
  analysis_timestamp: string;
}

interface AIAnalysisPanelProps {
  title: string;
  description: string;
  onAnalysisComplete?: (result: AnalysisResult) => void;
  disabled?: boolean;
}

export default function AIAnalysisPanel({ 
  title, 
  description, 
  onAnalysisComplete,
  disabled = false 
}: AIAnalysisPanelProps) {
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const { toast } = useToast();

  const analysisMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/ai/analyze-job-description", {
        title,
        description
      });
      return res.json();
    },
    onSuccess: (result: AnalysisResult) => {
      setAnalysisResult(result);
      onAnalysisComplete?.(result);
      toast({
        title: "Analysis Complete",
        description: "AI has analyzed your job description and provided recommendations.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Analysis Failed",
        description: error.message || "Unable to analyze job description at this time.",
        variant: "destructive",
      });
    },
  });

  const getScoreColor = (score: number) => {
    if (score >= 80) return "text-green-400";
    if (score >= 60) return "text-yellow-400";
    return "text-red-400";
  };

  const getScoreDescription = (score: number) => {
    if (score >= 90) return "Excellent";
    if (score >= 80) return "Very Good";
    if (score >= 70) return "Good";
    if (score >= 60) return "Fair";
    return "Needs Improvement";
  };

  const ScoreRing = ({ score, label, icon: Icon }: { score: number; label: string; icon: any }) => (
    <div className="flex flex-col items-center p-4 bg-slate-800/30 rounded-lg">
      <div className="relative w-16 h-16 mb-2">
        <svg className="w-16 h-16 transform -rotate-90" viewBox="0 0 100 100">
          <circle
            cx="50"
            cy="50"
            r="40"
            stroke="currentColor"
            strokeWidth="8"
            fill="transparent"
            className="text-slate-600"
          />
          <circle
            cx="50"
            cy="50"
            r="40"
            stroke="currentColor"
            strokeWidth="8"
            fill="transparent"
            strokeDasharray={`${2 * Math.PI * 40}`}
            strokeDashoffset={`${2 * Math.PI * 40 * (1 - score / 100)}`}
            className={getScoreColor(score)}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <Icon className="w-6 h-6 text-white" />
        </div>
      </div>
      <div className="text-center">
        <div className={`text-2xl font-bold ${getScoreColor(score)}`}>
          {score}
        </div>
        <div className="text-sm text-gray-300 mb-1">{label}</div>
        <div className="text-xs text-gray-400">{getScoreDescription(score)}</div>
      </div>
    </div>
  );

  if (!title || !description) {
    return (
      <Card className="bg-white/10 backdrop-blur-sm border-white/20">
        <CardContent className="p-6">
          <div className="flex items-center justify-center space-x-2 text-gray-400">
            <Brain className="w-5 h-5" />
            <span>Add job title and description to enable AI analysis</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-white/10 backdrop-blur-sm border-white/20">
      <CardHeader>
        <CardTitle className="flex items-center space-x-2 text-white">
          <Sparkles className="w-5 h-5 text-purple-400" />
          <span>AI Job Analysis</span>
        </CardTitle>
        <CardDescription className="text-gray-300">
          Get intelligent insights to optimize your job posting for better performance
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {!analysisResult ? (
          <div className="text-center">
            <Button
              onClick={() => analysisMutation.mutate()}
              disabled={disabled || analysisMutation.isPending}
              className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white"
            >
              {analysisMutation.isPending ? (
                <>
                  <Clock className="w-4 h-4 mr-2 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Brain className="w-4 h-4 mr-2" />
                  Analyze with AI
                </>
              )}
            </Button>
            <p className="text-sm text-gray-400 mt-2">
              AI will evaluate clarity, inclusion, and SEO optimization
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Overall Score */}
            <div className="text-center p-4 bg-gradient-to-r from-purple-600/20 to-blue-600/20 rounded-lg border border-purple-400/30">
              <div className="flex items-center justify-center space-x-2 mb-2">
                <Target className="w-5 h-5 text-purple-400" />
                <h3 className="text-lg font-semibold text-white">Overall Score</h3>
              </div>
              <div className={`text-4xl font-bold ${getScoreColor(analysisResult.overall_score)}`}>
                {analysisResult.overall_score}/100
              </div>
              <p className="text-sm text-gray-300 mt-1">
                {getScoreDescription(analysisResult.overall_score)}
              </p>
            </div>

            {/* Individual Scores */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <ScoreRing 
                score={analysisResult.clarity_score} 
                label="Clarity" 
                icon={CheckCircle}
              />
              <ScoreRing 
                score={analysisResult.inclusion_score} 
                label="Inclusion" 
                icon={Users}
              />
              <ScoreRing 
                score={analysisResult.seo_score} 
                label="SEO" 
                icon={Search}
              />
            </div>

            {/* Bias Flags */}
            {analysisResult.bias_flags.length > 0 && (
              <Alert className="border-yellow-500/50 bg-yellow-500/10">
                <AlertTriangle className="h-4 w-4 text-yellow-400" />
                <AlertDescription className="text-yellow-200">
                  <strong>Bias Detected:</strong> Consider revising these terms: {" "}
                  {analysisResult.bias_flags.map((flag, index) => (
                    <Badge 
                      key={index} 
                      variant="outline" 
                      className="mx-1 border-yellow-400/50 text-yellow-300"
                    >
                      {flag}
                    </Badge>
                  ))}
                </AlertDescription>
              </Alert>
            )}

            {/* SEO Keywords */}
            {analysisResult.seo_keywords.length > 0 && (
              <div className="space-y-2">
                <h4 className="flex items-center space-x-2 text-white font-medium">
                  <TrendingUp className="w-4 h-4 text-blue-400" />
                  <span>Recommended SEO Keywords</span>
                </h4>
                <div className="flex flex-wrap gap-2">
                  {analysisResult.seo_keywords.map((keyword, index) => (
                    <Badge 
                      key={index} 
                      variant="outline" 
                      className="border-blue-400/50 text-blue-300"
                    >
                      {keyword}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Suggestions */}
            {analysisResult.suggestions.length > 0 && (
              <div className="space-y-3">
                <h4 className="flex items-center space-x-2 text-white font-medium">
                  <Lightbulb className="w-4 h-4 text-green-400" />
                  <span>AI Recommendations</span>
                </h4>
                <div className="space-y-2">
                  {analysisResult.suggestions.map((suggestion, index) => (
                    <div 
                      key={index} 
                      className="flex items-start space-x-2 p-3 bg-slate-800/30 rounded-lg"
                    >
                      <CheckCircle className="w-4 h-4 text-green-400 mt-0.5 flex-shrink-0" />
                      <span className="text-sm text-gray-300">{suggestion}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Analysis Info */}
            <div className="flex justify-between items-center text-xs text-gray-400 pt-4 border-t border-white/10">
              <span>Model: {analysisResult.model_version}</span>
              <span>
                Analyzed: {new Date(analysisResult.analysis_timestamp).toLocaleString()}
              </span>
            </div>

            {/* Re-analyze Button */}
            <Button
              onClick={() => analysisMutation.mutate()}
              disabled={analysisMutation.isPending}
              variant="outline"
              size="sm"
              className="w-full border-slate-600 text-white hover:bg-slate-700"
            >
              {analysisMutation.isPending ? (
                <>
                  <Clock className="w-4 h-4 mr-2 animate-spin" />
                  Re-analyzing...
                </>
              ) : (
                <>
                  <Brain className="w-4 h-4 mr-2" />
                  Re-analyze
                </>
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}