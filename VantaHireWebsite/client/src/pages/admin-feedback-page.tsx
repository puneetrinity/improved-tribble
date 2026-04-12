import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import {
  MessageSquare,
  TrendingUp,
  ThumbsUp,
  ThumbsDown,
  Minus,
  Star,
  Calendar,
  Loader2,
  BarChart3,
} from "lucide-react";
import Layout from "@/components/Layout";
import { useAuth } from "@/hooks/use-auth";
import { Redirect } from "wouter";
import { apiRequest } from "@/lib/queryClient";

interface FeedbackRecord {
  id: number;
  applicationId: number;
  score: number | null;
  recommendation: string | null;
  notes: string | null;
  createdAt: string;
  reviewerName: string | null;
}

interface FeedbackStats {
  totalFeedback: number;
  avgScore: number;
  byRecommendation: {
    advance: number;
    hold: number;
    reject: number;
  };
  scoreDistribution: Record<string, number>;
}

interface FeedbackData {
  feedback: FeedbackRecord[];
  stats: FeedbackStats;
  timeline: Record<string, number>;
}

export default function AdminFeedbackPage() {
  const { user } = useAuth();
  const [dateRange, setDateRange] = useState("30");

  // Redirect non-admin users
  if (!user || user.role !== "super_admin") {
    return <Redirect to="/recruiter-auth" />;
  }

  // Calculate date range
  const getDateParams = () => {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(dateRange));
    return { startDate: startDate.toISOString(), endDate: endDate.toISOString() };
  };

  // Fetch feedback data
  const { data, isLoading } = useQuery<FeedbackData>({
    queryKey: ["/api/admin/feedback/analytics", dateRange],
    queryFn: async () => {
      const { startDate, endDate } = getDateParams();
      const params = new URLSearchParams({ startDate, endDate });
      const res = await apiRequest("GET", `/api/admin/feedback/analytics?${params}`);
      return res.json();
    },
  });

  const feedback = data?.feedback || [];
  const stats = data?.stats || {
    totalFeedback: 0,
    avgScore: 0,
    byRecommendation: { advance: 0, hold: 0, reject: 0 },
    scoreDistribution: {},
  };

  const totalRecommendations = stats.byRecommendation.advance + stats.byRecommendation.hold + stats.byRecommendation.reject;

  const getRecommendationBadge = (recommendation: string | null) => {
    switch (recommendation) {
      case "advance":
        return <Badge className="bg-success/20 text-success-foreground border-0"><ThumbsUp className="w-3 h-3 mr-1" />Advance</Badge>;
      case "hold":
        return <Badge className="bg-warning/20 text-warning-foreground border-0"><Minus className="w-3 h-3 mr-1" />Hold</Badge>;
      case "reject":
        return <Badge className="bg-destructive/20 text-destructive border-0"><ThumbsDown className="w-3 h-3 mr-1" />Reject</Badge>;
      default:
        return <Badge variant="secondary">—</Badge>;
    }
  };

  const getScoreStars = (score: number | null) => {
    if (!score) return <span className="text-muted-foreground">—</span>;
    return (
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((s) => (
          <Star
            key={s}
            className={`w-4 h-4 ${s <= score ? "text-warning fill-amber-400" : "text-slate-200"}`}
          />
        ))}
      </div>
    );
  };

  // Calculate max for score distribution bars
  const maxScoreCount = Math.max(...Object.values(stats.scoreDistribution).map(Number), 1);

  return (
    <Layout>
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white p-6">
        <div className="max-w-7xl mx-auto space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
                <MessageSquare className="w-8 h-8 text-primary" />
                Feedback Analytics
              </h1>
              <p className="text-muted-foreground mt-1">Analyze candidate evaluation feedback patterns</p>
            </div>
            <Select value={dateRange} onValueChange={setDateRange}>
              <SelectTrigger className="w-[150px]">
                <Calendar className="w-4 h-4 mr-2" />
                <SelectValue placeholder="Date range" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Summary Stats */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Total Feedback</p>
                    <p className="text-2xl font-bold text-foreground">{stats.totalFeedback}</p>
                  </div>
                  <MessageSquare className="w-8 h-8 text-primary opacity-50" />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Avg Score</p>
                    <div className="flex items-center gap-2">
                      <p className="text-2xl font-bold text-warning">{stats.avgScore}</p>
                      <span className="text-muted-foreground">/ 5</span>
                    </div>
                  </div>
                  <Star className="w-8 h-8 text-warning opacity-50" />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Advance Rate</p>
                    <p className="text-2xl font-bold text-success">
                      {totalRecommendations > 0
                        ? Math.round((stats.byRecommendation.advance / totalRecommendations) * 100)
                        : 0}%
                    </p>
                  </div>
                  <ThumbsUp className="w-8 h-8 text-success opacity-50" />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Reject Rate</p>
                    <p className="text-2xl font-bold text-destructive">
                      {totalRecommendations > 0
                        ? Math.round((stats.byRecommendation.reject / totalRecommendations) * 100)
                        : 0}%
                    </p>
                  </div>
                  <ThumbsDown className="w-8 h-8 text-destructive opacity-50" />
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Recommendation Breakdown */}
            <Card>
              <CardHeader>
                <CardTitle>Recommendations</CardTitle>
                <CardDescription>Feedback breakdown by recommendation type</CardDescription>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 text-primary animate-spin" />
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center gap-4">
                      <div className="w-24 flex items-center gap-2">
                        <ThumbsUp className="w-4 h-4 text-success" />
                        <span className="text-sm">Advance</span>
                      </div>
                      <div className="flex-1">
                        <Progress
                          value={totalRecommendations > 0 ? (stats.byRecommendation.advance / totalRecommendations) * 100 : 0}
                          className="h-3 bg-success/20"
                        />
                      </div>
                      <span className="w-12 text-right font-semibold text-success">
                        {stats.byRecommendation.advance}
                      </span>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="w-24 flex items-center gap-2">
                        <Minus className="w-4 h-4 text-warning" />
                        <span className="text-sm">Hold</span>
                      </div>
                      <div className="flex-1">
                        <Progress
                          value={totalRecommendations > 0 ? (stats.byRecommendation.hold / totalRecommendations) * 100 : 0}
                          className="h-3 bg-warning/20"
                        />
                      </div>
                      <span className="w-12 text-right font-semibold text-warning">
                        {stats.byRecommendation.hold}
                      </span>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="w-24 flex items-center gap-2">
                        <ThumbsDown className="w-4 h-4 text-destructive" />
                        <span className="text-sm">Reject</span>
                      </div>
                      <div className="flex-1">
                        <Progress
                          value={totalRecommendations > 0 ? (stats.byRecommendation.reject / totalRecommendations) * 100 : 0}
                          className="h-3 bg-destructive/20"
                        />
                      </div>
                      <span className="w-12 text-right font-semibold text-destructive">
                        {stats.byRecommendation.reject}
                      </span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Score Distribution */}
            <Card>
              <CardHeader>
                <CardTitle>Score Distribution</CardTitle>
                <CardDescription>Breakdown of rating scores given</CardDescription>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 text-primary animate-spin" />
                  </div>
                ) : (
                  <div className="space-y-3">
                    {[5, 4, 3, 2, 1].map((score) => {
                      const count = stats.scoreDistribution[score] || 0;
                      const percent = maxScoreCount > 0 ? (count / maxScoreCount) * 100 : 0;
                      return (
                        <div key={score} className="flex items-center gap-3">
                          <div className="w-20 flex items-center gap-1">
                            <Star className="w-4 h-4 text-warning fill-amber-400" />
                            <span className="text-sm font-medium">{score}</span>
                          </div>
                          <div className="flex-1 h-6 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-amber-400 rounded-full transition-all"
                              style={{ width: `${percent}%` }}
                            />
                          </div>
                          <span className="w-8 text-right text-sm text-muted-foreground">{count}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Recent Feedback Table */}
          <Card>
            <CardHeader>
              <CardTitle>Recent Feedback</CardTitle>
              <CardDescription>Latest evaluation feedback submitted</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 text-primary animate-spin" />
                </div>
              ) : feedback.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>No feedback found for this period</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Score</TableHead>
                      <TableHead>Recommendation</TableHead>
                      <TableHead>Reviewer</TableHead>
                      <TableHead>Notes</TableHead>
                      <TableHead>Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {feedback.slice(0, 25).map((record) => (
                      <TableRow key={record.id}>
                        <TableCell>{getScoreStars(record.score)}</TableCell>
                        <TableCell>{getRecommendationBadge(record.recommendation)}</TableCell>
                        <TableCell>
                          <span className="text-sm">{record.reviewerName || "Unknown"}</span>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm text-muted-foreground line-clamp-1 max-w-xs">
                            {record.notes || "—"}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm text-muted-foreground">
                            {new Date(record.createdAt).toLocaleDateString()}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </Layout>
  );
}
