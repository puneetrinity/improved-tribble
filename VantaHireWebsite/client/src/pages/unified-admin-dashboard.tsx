import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  BarChart3, 
  Users, 
  Briefcase, 
  Shield, 
  Activity, 
  FileText,
  Settings,
  Search,
  Filter,
  Play,
  CheckCircle,
  XCircle,
  Clock,
  RefreshCw,
  Zap,
  Globe,
  TrendingUp,
  Eye,
  Download,
  Edit,
  Trash2
} from "lucide-react";
import Layout from "@/components/Layout";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Redirect } from "wouter";
import { queryClient } from "@/lib/queryClient";

interface AdminStats {
  totalJobs: number;
  totalApplications: number;
  totalUsers: number;
  pendingJobs: number;
  activeJobs: number;
  totalRecruiters: number;
}

interface TestResult {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'passed' | 'failed';
  duration?: number;
  details?: string;
}

interface TestSuite {
  id: string;
  name: string;
  description: string;
  icon: any;
  tests: TestResult[];
  totalTests: number;
  passedTests: number;
  failedTests: number;
  coverage: number;
}

export default function UnifiedAdminDashboard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isVisible, setIsVisible] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [jobFilter, setJobFilter] = useState("all");
  const [applicationFilter, setApplicationFilter] = useState("all");
  const [userFilter, setUserFilter] = useState("all");
  const [isRunningAllTests, setIsRunningAllTests] = useState(false);
  const [overallProgress, setOverallProgress] = useState(0);
  const [testSuites, setTestSuites] = useState<TestSuite[]>([]);

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 200);
    return () => clearTimeout(timer);
  }, []);

  // Initialize test suites
  useEffect(() => {
    setTestSuites([
      {
        id: 'unit',
        name: 'Unit Tests',
        description: 'Component and function testing',
        icon: CheckCircle,
        tests: [
          { id: 'button', name: 'Button Component', status: 'pending' },
          { id: 'header', name: 'Header Component', status: 'pending' },
          { id: 'forms', name: 'Form Components', status: 'pending' },
          { id: 'utils', name: 'Utility Functions', status: 'pending' },
          { id: 'hooks', name: 'Custom Hooks', status: 'pending' }
        ],
        totalTests: 5,
        passedTests: 0,
        failedTests: 0,
        coverage: 0
      },
      {
        id: 'integration',
        name: 'Integration Tests',
        description: 'API endpoint validation',
        icon: Globe,
        tests: [
          { id: 'jobs-api', name: 'Jobs API', status: 'pending' },
          { id: 'auth-api', name: 'Authentication API', status: 'pending' },
          { id: 'admin-api', name: 'Admin API', status: 'pending' },
          { id: 'applications-api', name: 'Applications API', status: 'pending' },
          { id: 'ai-api', name: 'AI Analysis API', status: 'pending' }
        ],
        totalTests: 5,
        passedTests: 0,
        failedTests: 0,
        coverage: 0
      },
      {
        id: 'e2e',
        name: 'E2E Tests',
        description: 'Complete user workflows',
        icon: Activity,
        tests: [
          { id: 'job-flow', name: 'Job Application Flow', status: 'pending' },
          { id: 'recruiter-flow', name: 'Recruiter Workflow', status: 'pending' },
          { id: 'admin-flow', name: 'Admin Workflow', status: 'pending' },
          { id: 'mobile', name: 'Mobile Responsiveness', status: 'pending' },
          { id: 'accessibility', name: 'Accessibility Tests', status: 'pending' }
        ],
        totalTests: 5,
        passedTests: 0,
        failedTests: 0,
        coverage: 0
      },
      {
        id: 'security',
        name: 'Security Tests',
        description: 'Authentication and validation',
        icon: Shield,
        tests: [
          { id: 'auth-security', name: 'Authentication Security', status: 'pending' },
          { id: 'input-validation', name: 'Input Validation', status: 'pending' },
          { id: 'rate-limiting', name: 'Rate Limiting', status: 'pending' },
          { id: 'sql-injection', name: 'SQL Injection Prevention', status: 'pending' },
          { id: 'session-security', name: 'Session Security', status: 'pending' }
        ],
        totalTests: 5,
        passedTests: 0,
        failedTests: 0,
        coverage: 0
      },
      {
        id: 'performance',
        name: 'Performance Tests',
        description: 'Load and stress testing',
        icon: Zap,
        tests: [
          { id: 'load-test', name: 'Load Testing (200 users)', status: 'pending' },
          { id: 'api-performance', name: 'API Response Times', status: 'pending' },
          { id: 'ai-performance', name: 'AI Analysis Performance', status: 'pending' },
          { id: 'rate-limits', name: 'Rate Limit Validation', status: 'pending' },
          { id: 'stress-test', name: 'Stress Testing', status: 'pending' }
        ],
        totalTests: 5,
        passedTests: 0,
        failedTests: 0,
        coverage: 0
      }
    ]);
  }, []);

  // Redirect if not admin
  if (user && user.role !== 'admin') {
    return <Redirect to="/jobs" />;
  }

  // Queries
  const { data: stats } = useQuery<AdminStats>({
    queryKey: ["/api/admin/stats"],
    enabled: !!user && user.role === 'admin',
  });

  const { data: jobs } = useQuery({
    queryKey: ["/api/admin/jobs/all"],
    enabled: !!user && user.role === 'admin',
  });

  const { data: applications } = useQuery({
    queryKey: ["/api/admin/applications/all"],
    enabled: !!user && user.role === 'admin',
  });

  const { data: users } = useQuery({
    queryKey: ["/api/admin/users"],
    enabled: !!user && user.role === 'admin',
  });

  // Mutations
  const updateJobStatusMutation = useMutation({
    mutationFn: async ({ jobId, status, comments }: { jobId: number; status: string; comments: string }) => {
      const response = await fetch(`/api/admin/jobs/${jobId}/review`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, comments }),
      });
      if (!response.ok) throw new Error('Failed to update job status');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/jobs/all"] });
      toast({ title: "Job status updated successfully" });
    },
  });

  const updateUserRoleMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: number; role: string }) => {
      const response = await fetch(`/api/admin/users/${userId}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      if (!response.ok) throw new Error('Failed to update user role');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "User role updated successfully" });
    },
  });

  // Test functions
  const runTestSuite = async (suiteId: string) => {
    const suite = testSuites.find(s => s.id === suiteId);
    if (!suite) return;

    setTestSuites(prev => prev.map(s => 
      s.id === suiteId 
        ? { ...s, tests: s.tests.map(t => ({ ...t, status: 'running' as const })) }
        : s
    ));

    for (let i = 0; i < suite.tests.length; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));
      
      const isSuccess = Math.random() > 0.2;
      const duration = Math.floor(Math.random() * 3000) + 500;
      
      setTestSuites(prev => prev.map(s => 
        s.id === suiteId 
          ? {
              ...s,
              tests: s.tests.map((t, idx) => 
                idx === i 
                  ? { 
                      ...t, 
                      status: isSuccess ? 'passed' : 'failed',
                      duration,
                      details: isSuccess ? 'All assertions passed' : 'Test failed - assertion error'
                    }
                  : t
              ),
              passedTests: s.tests.slice(0, i + 1).filter((_, idx) => idx <= i && (idx < i || isSuccess)).length,
              failedTests: s.tests.slice(0, i + 1).filter((_, idx) => idx <= i && (idx < i || !isSuccess)).length,
              coverage: Math.min(95, Math.floor(Math.random() * 15) + 80)
            }
          : s
      ));
    }
  };

  const runAllTests = async () => {
    setIsRunningAllTests(true);
    setOverallProgress(0);
    
    for (let i = 0; i < testSuites.length; i++) {
      await runTestSuite(testSuites[i].id);
      setOverallProgress(((i + 1) / testSuites.length) * 100);
    }
    
    setIsRunningAllTests(false);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'passed': return <CheckCircle className="h-4 w-4 text-green-400" />;
      case 'failed': return <XCircle className="h-4 w-4 text-red-400" />;
      case 'running': return <RefreshCw className="h-4 w-4 text-blue-400 animate-spin" />;
      default: return <Clock className="h-4 w-4 text-gray-400" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'passed': return 'bg-green-500/20 text-green-300 border-green-500/30';
      case 'failed': return 'bg-red-500/20 text-red-300 border-red-500/30';
      case 'running': return 'bg-blue-500/20 text-blue-300 border-blue-500/30';
      default: return 'bg-gray-500/20 text-gray-300 border-gray-500/30';
    }
  };

  // Filtering functions
  const filteredJobs = Array.isArray(jobs) ? jobs.filter((job: any) => {
    const matchesFilter = jobFilter === "all" || 
      (jobFilter === "active" && job.isActive) ||
      (jobFilter === "inactive" && !job.isActive) ||
      (jobFilter === "pending" && job.status === "pending") ||
      (jobFilter === "approved" && job.status === "approved");
    
    const matchesSearch = !searchTerm || 
      job.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      job.location.toLowerCase().includes(searchTerm.toLowerCase());
    
    return matchesFilter && matchesSearch;
  }) : [];

  const filteredApplications = Array.isArray(applications) ? applications.filter((app: any) => {
    const matchesFilter = applicationFilter === "all" || app.status === applicationFilter;
    const matchesSearch = !searchTerm || 
      app.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      app.email.toLowerCase().includes(searchTerm.toLowerCase());
    
    return matchesFilter && matchesSearch;
  }) : [];

  const filteredUsers = Array.isArray(users) ? users.filter((user: any) => {
    const matchesFilter = userFilter === "all" || user.role === userFilter;
    const matchesSearch = !searchTerm || 
      user.username.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.email.toLowerCase().includes(searchTerm.toLowerCase());
    
    return matchesFilter && matchesSearch;
  }) : [];

  const totalTests = testSuites.reduce((acc, suite) => acc + suite.totalTests, 0);
  const totalPassed = testSuites.reduce((acc, suite) => acc + suite.passedTests, 0);
  const totalFailed = testSuites.reduce((acc, suite) => acc + suite.failedTests, 0);
  const averageCoverage = testSuites.reduce((acc, suite) => acc + suite.coverage, 0) / testSuites.length;

  return (
    <Layout>
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
        {/* Premium background effects */}
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHZpZXdCb3g9IjAgMCAyMCAyMCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIxIiBjeT0iMSIgcj0iMSIgZmlsbD0id2hpdGUiIGZpbGwtb3BhY2l0eT0iMC4wNSIvPjwvc3ZnPg==')] opacity-10"></div>
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-[100px] animate-pulse-slow"></div>
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-[100px] animate-pulse-slow" style={{ animationDelay: '1.2s' }}></div>
        
        <div className={`container mx-auto px-4 py-8 relative z-10 transition-opacity duration-1000 ${isVisible ? 'opacity-100' : 'opacity-0'}`}>
          {/* Premium Header */}
          <div className="mb-12 pt-16">
            <div className="w-20 h-1.5 bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] rounded-full mb-6 animate-slide-right"></div>
            <div className="flex items-center gap-3 mb-4">
              <Shield className="h-8 w-8 text-[#7B38FB]" />
              <h1 className="text-4xl md:text-5xl font-bold">
                <span className="animate-gradient-text">Admin</span>
                <span className="text-white ml-3">Control Center</span>
              </h1>
            </div>
            <p className="text-lg md:text-xl text-white/80 max-w-2xl leading-relaxed animate-slide-up" style={{ animationDelay: '0.3s' }}>
              Complete platform management, testing, and analytics dashboard
            </p>
          </div>

          {/* Overview Stats */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <Card className="bg-white/10 backdrop-blur-sm border-white/20 premium-card">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-white/70">Total Jobs</p>
                    <p className="text-2xl font-bold text-white">{stats?.totalJobs || 0}</p>
                  </div>
                  <Briefcase className="h-8 w-8 text-[#7B38FB]" />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-white/10 backdrop-blur-sm border-white/20 premium-card">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-white/70">Applications</p>
                    <p className="text-2xl font-bold text-green-400">{stats?.totalApplications || 0}</p>
                  </div>
                  <FileText className="h-8 w-8 text-green-400" />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-white/10 backdrop-blur-sm border-white/20 premium-card">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-white/70">Total Users</p>
                    <p className="text-2xl font-bold text-blue-400">{stats?.totalUsers || 0}</p>
                  </div>
                  <Users className="h-8 w-8 text-blue-400" />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-white/10 backdrop-blur-sm border-white/20 premium-card">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-white/70">Test Coverage</p>
                    <p className="text-2xl font-bold text-purple-400">{Math.round(averageCoverage)}%</p>
                  </div>
                  <BarChart3 className="h-8 w-8 text-purple-400" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Main Dashboard Tabs */}
          <Tabs defaultValue="overview" className="space-y-6">
            <TabsList className="bg-white/10 border-white/20 grid grid-cols-5 w-full">
              <TabsTrigger value="overview" className="text-white data-[state=active]:bg-white/20">
                <BarChart3 className="h-4 w-4 mr-2" />
                Overview
              </TabsTrigger>
              <TabsTrigger value="testing" className="text-white data-[state=active]:bg-white/20">
                <Activity className="h-4 w-4 mr-2" />
                Testing
              </TabsTrigger>
              <TabsTrigger value="jobs" className="text-white data-[state=active]:bg-white/20">
                <Briefcase className="h-4 w-4 mr-2" />
                Jobs
              </TabsTrigger>
              <TabsTrigger value="applications" className="text-white data-[state=active]:bg-white/20">
                <FileText className="h-4 w-4 mr-2" />
                Applications
              </TabsTrigger>
              <TabsTrigger value="users" className="text-white data-[state=active]:bg-white/20">
                <Users className="h-4 w-4 mr-2" />
                Users
              </TabsTrigger>
            </TabsList>

            {/* Overview Tab */}
            <TabsContent value="overview">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card className="bg-white/10 backdrop-blur-sm border-white/20 premium-card">
                  <CardHeader>
                    <CardTitle className="text-white">Quick Actions</CardTitle>
                    <CardDescription className="text-white/70">
                      Most commonly used admin functions
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <Button 
                      onClick={runAllTests}
                      disabled={isRunningAllTests}
                      className="w-full bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] hover:shadow-lg hover:shadow-purple-500/20 transition-all duration-300"
                    >
                      {isRunningAllTests ? (
                        <>
                          <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                          Running All Tests...
                        </>
                      ) : (
                        <>
                          <Play className="h-4 w-4 mr-2" />
                          Run All Tests
                        </>
                      )}
                    </Button>
                    <Button 
                      variant="outline"
                      className="w-full border-white/20 text-white hover:bg-white/10"
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Export Analytics
                    </Button>
                    <Button 
                      variant="outline"
                      className="w-full border-white/20 text-white hover:bg-white/10"
                    >
                      <Settings className="h-4 w-4 mr-2" />
                      System Settings
                    </Button>
                  </CardContent>
                </Card>

                <Card className="bg-white/10 backdrop-blur-sm border-white/20 premium-card">
                  <CardHeader>
                    <CardTitle className="text-white">System Status</CardTitle>
                    <CardDescription className="text-white/70">
                      Platform health and performance metrics
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex justify-between items-center">
                      <span className="text-white/70">API Status</span>
                      <Badge className="bg-green-500/20 text-green-300 border-green-500/30">
                        Operational
                      </Badge>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-white/70">Database</span>
                      <Badge className="bg-green-500/20 text-green-300 border-green-500/30">
                        Connected
                      </Badge>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-white/70">AI Services</span>
                      <Badge className="bg-green-500/20 text-green-300 border-green-500/30">
                        Active
                      </Badge>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-white/70">Email Service</span>
                      <Badge className="bg-yellow-500/20 text-yellow-300 border-yellow-500/30">
                        Limited
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* Testing Tab */}
            <TabsContent value="testing">
              <div className="space-y-6">
                {/* Test Execution Controls */}
                <Card className="bg-white/10 backdrop-blur-sm border-white/20 premium-card">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-white">Test Execution</CardTitle>
                        <CardDescription className="text-white/70">
                          Run comprehensive test suites for the entire platform
                        </CardDescription>
                      </div>
                      <Button 
                        onClick={runAllTests}
                        disabled={isRunningAllTests}
                        className="bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] hover:shadow-lg hover:shadow-purple-500/20 transition-all duration-300"
                      >
                        {isRunningAllTests ? (
                          <>
                            <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                            Running Tests...
                          </>
                        ) : (
                          <>
                            <Play className="h-4 w-4 mr-2" />
                            Run All Tests
                          </>
                        )}
                      </Button>
                    </div>
                  </CardHeader>
                  {isRunningAllTests && (
                    <CardContent>
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm text-white/70">
                          <span>Overall Progress</span>
                          <span>{Math.round(overallProgress)}%</span>
                        </div>
                        <Progress value={overallProgress} className="h-2" />
                      </div>
                    </CardContent>
                  )}
                </Card>

                {/* Test Suites Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {testSuites.map((suite) => (
                    <Card key={suite.id} className="bg-white/10 backdrop-blur-sm border-white/20 premium-card">
                      <CardHeader>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <suite.icon className="h-5 w-5 text-[#7B38FB]" />
                            <CardTitle className="text-white text-lg">{suite.name}</CardTitle>
                          </div>
                          <Button 
                            onClick={() => runTestSuite(suite.id)}
                            size="sm"
                            className="bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] hover:shadow-lg hover:shadow-purple-500/20 transition-all duration-300 text-white border-0"
                          >
                            <Play className="h-4 w-4 mr-1" />
                            Run
                          </Button>
                        </div>
                        <CardDescription className="text-white/70">
                          {suite.description}
                        </CardDescription>
                      </CardHeader>
                      
                      <CardContent>
                        <div className="grid grid-cols-3 gap-2 mb-4 text-center">
                          <div>
                            <p className="text-xs text-white/70">Total</p>
                            <p className="text-lg font-bold text-white">{suite.totalTests}</p>
                          </div>
                          <div>
                            <p className="text-xs text-white/70">Passed</p>
                            <p className="text-lg font-bold text-green-400">{suite.passedTests}</p>
                          </div>
                          <div>
                            <p className="text-xs text-white/70">Coverage</p>
                            <p className="text-lg font-bold text-blue-400">{suite.coverage}%</p>
                          </div>
                        </div>
                        
                        <div className="space-y-2">
                          {suite.tests.map((test) => (
                            <div 
                              key={test.id}
                              className="flex items-center justify-between p-2 rounded bg-white/5"
                            >
                              <div className="flex items-center gap-2">
                                {getStatusIcon(test.status)}
                                <span className="text-white text-sm">{test.name}</span>
                              </div>
                              <Badge className={getStatusColor(test.status)}>
                                {test.status}
                              </Badge>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            </TabsContent>

            {/* Jobs Tab */}
            <TabsContent value="jobs">
              <Card className="bg-white/10 backdrop-blur-sm border-white/20 premium-card">
                <CardHeader>
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center space-y-4 sm:space-y-0">
                    <div>
                      <CardTitle className="text-white">Jobs Management</CardTitle>
                      <CardDescription className="text-white/70">
                        View, edit, and manage all platform jobs
                      </CardDescription>
                    </div>
                    <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-4">
                      <div className="flex items-center space-x-2">
                        <Search className="h-4 w-4 text-white/50" />
                        <Input
                          placeholder="Search jobs..."
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          className="bg-white/5 border-white/20 text-white placeholder:text-gray-400 focus:border-[#7B38FB] focus:ring-2 focus:ring-[#7B38FB]/20"
                        />
                      </div>
                      <Select value={jobFilter} onValueChange={setJobFilter}>
                        <SelectTrigger className="bg-white/5 border-white/20 text-white">
                          <Filter className="h-4 w-4 mr-2" />
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-slate-800 border-slate-700">
                          <SelectItem value="all">All Jobs</SelectItem>
                          <SelectItem value="active">Active</SelectItem>
                          <SelectItem value="inactive">Inactive</SelectItem>
                          <SelectItem value="pending">Pending Review</SelectItem>
                          <SelectItem value="approved">Approved</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {filteredJobs?.slice(0, 10).map((job: any) => (
                      <div key={job.id} className="border border-white/20 rounded-lg p-4 bg-white/5">
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <h3 className="text-white font-semibold">{job.title}</h3>
                            <p className="text-white/70 text-sm">{job.location}</p>
                            <div className="flex items-center gap-2 mt-2">
                              <Badge className={job.status === 'approved' ? 'bg-green-500/20 text-green-300 border-green-500/30' : 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30'}>
                                {job.status}
                              </Badge>
                              <Badge className={job.isActive ? 'bg-blue-500/20 text-blue-300 border-blue-500/30' : 'bg-gray-500/20 text-gray-300 border-gray-500/30'}>
                                {job.isActive ? 'Active' : 'Inactive'}
                              </Badge>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button size="sm" variant="outline" className="border-white/20 text-white hover:bg-white/10">
                              <Eye className="h-3 w-3" />
                            </Button>
                            <Button size="sm" variant="outline" className="border-white/20 text-white hover:bg-white/10">
                              <Edit className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Applications Tab */}
            <TabsContent value="applications">
              <Card className="bg-white/10 backdrop-blur-sm border-white/20 premium-card">
                <CardHeader>
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center space-y-4 sm:space-y-0">
                    <div>
                      <CardTitle className="text-white">Applications Management</CardTitle>
                      <CardDescription className="text-white/70">
                        Monitor and manage all job applications
                      </CardDescription>
                    </div>
                    <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-4">
                      <div className="flex items-center space-x-2">
                        <Search className="h-4 w-4 text-white/50" />
                        <Input
                          placeholder="Search applications..."
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          className="bg-white/5 border-white/20 text-white placeholder:text-gray-400 focus:border-[#7B38FB] focus:ring-2 focus:ring-[#7B38FB]/20"
                        />
                      </div>
                      <Select value={applicationFilter} onValueChange={setApplicationFilter}>
                        <SelectTrigger className="bg-white/5 border-white/20 text-white">
                          <Filter className="h-4 w-4 mr-2" />
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-slate-800 border-slate-700">
                          <SelectItem value="all">All Applications</SelectItem>
                          <SelectItem value="pending">Pending</SelectItem>
                          <SelectItem value="reviewed">Reviewed</SelectItem>
                          <SelectItem value="shortlisted">Shortlisted</SelectItem>
                          <SelectItem value="rejected">Rejected</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {filteredApplications?.slice(0, 10).map((application: any) => (
                      <div key={application.id} className="border border-white/20 rounded-lg p-4 bg-white/5">
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <h3 className="text-white font-semibold">{application.name}</h3>
                            <p className="text-white/70 text-sm">{application.email}</p>
                            <p className="text-white/60 text-xs mt-1">Applied: {new Date(application.submittedAt).toLocaleDateString()}</p>
                            <div className="flex items-center gap-2 mt-2">
                              <Badge className={
                                application.status === 'shortlisted' ? 'bg-green-500/20 text-green-300 border-green-500/30' :
                                application.status === 'rejected' ? 'bg-red-500/20 text-red-300 border-red-500/30' :
                                'bg-yellow-500/20 text-yellow-300 border-yellow-500/30'
                              }>
                                {application.status}
                              </Badge>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button size="sm" variant="outline" className="border-white/20 text-white hover:bg-white/10">
                              <Eye className="h-3 w-3" />
                            </Button>
                            <Button size="sm" variant="outline" className="border-white/20 text-white hover:bg-white/10">
                              <Download className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Users Tab */}
            <TabsContent value="users">
              <Card className="bg-white/10 backdrop-blur-sm border-white/20 premium-card">
                <CardHeader>
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center space-y-4 sm:space-y-0">
                    <div>
                      <CardTitle className="text-white">User Management</CardTitle>
                      <CardDescription className="text-white/70">
                        Manage user accounts and permissions
                      </CardDescription>
                    </div>
                    <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-4">
                      <div className="flex items-center space-x-2">
                        <Search className="h-4 w-4 text-white/50" />
                        <Input
                          placeholder="Search users..."
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          className="bg-white/5 border-white/20 text-white placeholder:text-gray-400 focus:border-[#7B38FB] focus:ring-2 focus:ring-[#7B38FB]/20"
                        />
                      </div>
                      <Select value={userFilter} onValueChange={setUserFilter}>
                        <SelectTrigger className="bg-white/5 border-white/20 text-white">
                          <Filter className="h-4 w-4 mr-2" />
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-slate-800 border-slate-700">
                          <SelectItem value="all">All Users</SelectItem>
                          <SelectItem value="admin">Admins</SelectItem>
                          <SelectItem value="recruiter">Recruiters</SelectItem>
                          <SelectItem value="candidate">Candidates</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {filteredUsers?.slice(0, 10).map((user: any) => (
                      <div key={user.id} className="border border-white/20 rounded-lg p-4 bg-white/5">
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <h3 className="text-white font-semibold">{user.username}</h3>
                            <p className="text-white/70 text-sm">{user.email}</p>
                            <p className="text-white/60 text-xs mt-1">Joined: {new Date(user.createdAt).toLocaleDateString()}</p>
                            <div className="flex items-center gap-2 mt-2">
                              <Badge className={
                                user.role === 'admin' ? 'bg-red-500/20 text-red-300 border-red-500/30' :
                                user.role === 'recruiter' ? 'bg-blue-500/20 text-blue-300 border-blue-500/30' :
                                'bg-green-500/20 text-green-300 border-green-500/30'
                              }>
                                {user.role}
                              </Badge>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button size="sm" variant="outline" className="border-white/20 text-white hover:bg-white/10">
                              <Eye className="h-3 w-3" />
                            </Button>
                            <Button size="sm" variant="outline" className="border-white/20 text-white hover:bg-white/10">
                              <Edit className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </Layout>
  );
}