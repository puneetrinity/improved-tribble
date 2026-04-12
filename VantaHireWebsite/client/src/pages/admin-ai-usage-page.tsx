import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  Cpu,
  DollarSign,
  Zap,
  TrendingUp,
  Loader2,
  Calendar,
  User,
  FileText,
  Brain,
  Mail,
} from "lucide-react";
import Layout from "@/components/Layout";
import { useAuth } from "@/hooks/use-auth";
import { Redirect } from "wouter";
import { apiRequest } from "@/lib/queryClient";

interface AIUsageRecord {
  id: number;
  userId: number;
  kind: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: string;
  computedAt: string;
  metadata: any;
  user: {
    id: number;
    username: string;
    firstName: string | null;
    lastName: string | null;
  } | null;
}

interface AIUsageSummary {
  byKind: Record<string, { tokensIn: number; tokensOut: number; cost: number; count: number }>;
  total: { tokensIn: number; tokensOut: number; cost: number; count: number };
}

interface AIUsageData {
  usage: AIUsageRecord[];
  summary: AIUsageSummary;
}

const kindLabels: Record<string, { label: string; icon: any; color: string }> = {
  form_ai: { label: "Form Questions", icon: FileText, color: "bg-info/20 text-info-foreground" },
  job_ai: { label: "Job Analysis", icon: Brain, color: "bg-primary/20 text-primary" },
  candidate_summary: { label: "Candidate Summary", icon: User, color: "bg-success/20 text-success-foreground" },
  email_draft: { label: "Email Draft", icon: Mail, color: "bg-warning/20 text-warning-foreground" },
  resume_analysis: { label: "Resume Analysis", icon: FileText, color: "bg-pink-100 text-pink-700" },
};

export default function AdminAIUsagePage() {
  const { user } = useAuth();
  const [dateRange, setDateRange] = useState("30");
  const [kindFilter, setKindFilter] = useState("all");

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

  // Fetch AI usage data
  const { data, isLoading } = useQuery<AIUsageData>({
    queryKey: ["/api/admin/ai/usage", dateRange, kindFilter],
    queryFn: async () => {
      const { startDate, endDate } = getDateParams();
      const params = new URLSearchParams({ startDate, endDate });
      if (kindFilter !== "all") params.append("kind", kindFilter);
      const res = await apiRequest("GET", `/api/admin/ai/usage?${params}`);
      return res.json();
    },
  });

  const usage = data?.usage || [];
  const summary = data?.summary || { byKind: {}, total: { tokensIn: 0, tokensOut: 0, cost: 0, count: 0 } };

  // Calculate max for progress bars
  const maxCost = Math.max(...Object.values(summary.byKind).map(k => k.cost), 0.01);

  const getKindBadge = (kind: string) => {
    const config = kindLabels[kind] || { label: kind, icon: Cpu, color: "bg-muted text-foreground" };
    const Icon = config.icon;
    return (
      <Badge className={`${config.color} border-0`}>
        <Icon className="w-3 h-3 mr-1" />
        {config.label}
      </Badge>
    );
  };

  const formatTokens = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  const formatCost = (cost: number | string) => {
    const num = typeof cost === "string" ? parseFloat(cost) : cost;
    return `$${num.toFixed(4)}`;
  };

  return (
    <Layout>
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white p-6">
        <div className="max-w-7xl mx-auto space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
                <Cpu className="w-8 h-8 text-primary" />
                AI Usage Dashboard
              </h1>
              <p className="text-muted-foreground mt-1">Monitor AI feature usage and costs across the platform</p>
            </div>
            <div className="flex gap-3">
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
              <Select value={kindFilter} onValueChange={setKindFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Filter by type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  {Object.entries(kindLabels).map(([key, { label }]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Summary Stats */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Total API Calls</p>
                    <p className="text-2xl font-bold text-foreground">{summary.total.count}</p>
                  </div>
                  <Zap className="w-8 h-8 text-warning opacity-50" />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Total Cost</p>
                    <p className="text-2xl font-bold text-success">{formatCost(summary.total.cost)}</p>
                  </div>
                  <DollarSign className="w-8 h-8 text-success opacity-50" />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Input Tokens</p>
                    <p className="text-2xl font-bold text-info">{formatTokens(summary.total.tokensIn)}</p>
                  </div>
                  <TrendingUp className="w-8 h-8 text-info opacity-50" />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Output Tokens</p>
                    <p className="text-2xl font-bold text-primary">{formatTokens(summary.total.tokensOut)}</p>
                  </div>
                  <Cpu className="w-8 h-8 text-primary opacity-50" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Usage by Feature */}
          <Card>
            <CardHeader>
              <CardTitle>Usage by Feature</CardTitle>
              <CardDescription>Cost breakdown by AI feature type</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 text-primary animate-spin" />
                </div>
              ) : Object.keys(summary.byKind).length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Cpu className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>No AI usage data for this period</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {Object.entries(summary.byKind).map(([kind, stats]) => {
                    const config = kindLabels[kind] || { label: kind, icon: Cpu, color: "" };
                    const Icon = config.icon;
                    const progressPercent = (stats.cost / maxCost) * 100;

                    return (
                      <div key={kind} className="flex items-center gap-4">
                        <div className="w-40 flex items-center gap-2">
                          <Icon className="w-4 h-4 text-muted-foreground" />
                          <span className="text-sm font-medium">{config.label}</span>
                        </div>
                        <div className="flex-1">
                          <Progress value={progressPercent} className="h-2" />
                        </div>
                        <div className="w-24 text-right">
                          <span className="text-sm font-semibold text-foreground">{formatCost(stats.cost)}</span>
                        </div>
                        <div className="w-16 text-right">
                          <span className="text-xs text-muted-foreground">{stats.count} calls</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent Usage Table */}
          <Card>
            <CardHeader>
              <CardTitle>Recent AI Calls</CardTitle>
              <CardDescription>Last {usage.length} API requests</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 text-primary animate-spin" />
                </div>
              ) : usage.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Cpu className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>No usage records found</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>User</TableHead>
                      <TableHead>Tokens (In/Out)</TableHead>
                      <TableHead>Cost</TableHead>
                      <TableHead>Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {usage.slice(0, 50).map((record) => (
                      <TableRow key={record.id}>
                        <TableCell>{getKindBadge(record.kind)}</TableCell>
                        <TableCell>
                          {record.user ? (
                            <span className="text-sm">
                              {record.user.firstName || record.user.username}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">System</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className="text-xs">
                            {formatTokens(record.tokensIn)} / {formatTokens(record.tokensOut)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm font-medium">{formatCost(record.costUsd)}</span>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm text-muted-foreground">
                            {new Date(record.computedAt).toLocaleDateString()}
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
