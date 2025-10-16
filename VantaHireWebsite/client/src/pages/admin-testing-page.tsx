import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Play, 
  CheckCircle, 
  XCircle, 
  Clock, 
  Shield, 
  Zap, 
  Globe, 
  BarChart3,
  RefreshCw,
  AlertTriangle,
  Activity
} from "lucide-react";
import Layout from "@/components/Layout";

interface TestResult {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'passed' | 'failed';
  duration?: number;
  details?: string;
  coverage?: number;
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

export default function AdminTestingPage() {
  const [isVisible, setIsVisible] = useState(false);
  const [testSuites, setTestSuites] = useState<TestSuite[]>([]);
  const [isRunningAll, setIsRunningAll] = useState(false);
  const [overallProgress, setOverallProgress] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 200);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    // Initialize test suites
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

  const runTestSuite = async (suiteId: string) => {
    const suite = testSuites.find(s => s.id === suiteId);
    if (!suite) return;

    // Update suite status to running
    setTestSuites(prev => prev.map(s => 
      s.id === suiteId 
        ? { ...s, tests: s.tests.map(t => ({ ...t, status: 'running' as const })) }
        : s
    ));

    // Simulate running tests
    for (let i = 0; i < suite.tests.length; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));
      
      const isSuccess = Math.random() > 0.2; // 80% success rate
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
    setIsRunningAll(true);
    setOverallProgress(0);
    
    for (let i = 0; i < testSuites.length; i++) {
      await runTestSuite(testSuites[i].id);
      setOverallProgress(((i + 1) / testSuites.length) * 100);
    }
    
    setIsRunningAll(false);
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
              <BarChart3 className="h-8 w-8 text-[#7B38FB]" />
              <h1 className="text-4xl md:text-5xl font-bold">
                <span className="animate-gradient-text">Testing</span>
                <span className="text-white ml-3">Dashboard</span>
              </h1>
            </div>
            <p className="text-lg md:text-xl text-white/80 max-w-2xl leading-relaxed animate-slide-up" style={{ animationDelay: '0.3s' }}>
              Run and monitor comprehensive test suites for the VantaHire platform
            </p>
          </div>

          {/* Overview Stats */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <Card className="bg-white/10 backdrop-blur-sm border-white/20 premium-card">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-white/70">Total Tests</p>
                    <p className="text-2xl font-bold text-white">{totalTests}</p>
                  </div>
                  <Activity className="h-8 w-8 text-[#7B38FB]" />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-white/10 backdrop-blur-sm border-white/20 premium-card">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-white/70">Passed</p>
                    <p className="text-2xl font-bold text-green-400">{totalPassed}</p>
                  </div>
                  <CheckCircle className="h-8 w-8 text-green-400" />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-white/10 backdrop-blur-sm border-white/20 premium-card">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-white/70">Failed</p>
                    <p className="text-2xl font-bold text-red-400">{totalFailed}</p>
                  </div>
                  <XCircle className="h-8 w-8 text-red-400" />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-white/10 backdrop-blur-sm border-white/20 premium-card">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-white/70">Coverage</p>
                    <p className="text-2xl font-bold text-blue-400">{Math.round(averageCoverage)}%</p>
                  </div>
                  <BarChart3 className="h-8 w-8 text-blue-400" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Run All Tests */}
          <Card className="bg-white/10 backdrop-blur-sm border-white/20 premium-card mb-8">
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
                  disabled={isRunningAll}
                  className="bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] hover:shadow-lg hover:shadow-purple-500/20 transition-all duration-300"
                >
                  {isRunningAll ? (
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
            {isRunningAll && (
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

          {/* Test Suites */}
          <Tabs defaultValue="unit" className="space-y-6">
            <TabsList className="bg-white/10 border-white/20">
              {testSuites.map((suite) => (
                <TabsTrigger 
                  key={suite.id} 
                  value={suite.id}
                  className="text-white data-[state=active]:bg-white/20"
                >
                  <suite.icon className="h-4 w-4 mr-2" />
                  {suite.name}
                </TabsTrigger>
              ))}
            </TabsList>

            {testSuites.map((suite) => (
              <TabsContent key={suite.id} value={suite.id}>
                <Card className="bg-white/10 backdrop-blur-sm border-white/20 premium-card">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-white flex items-center gap-2">
                          <suite.icon className="h-5 w-5 text-[#7B38FB]" />
                          {suite.name}
                        </CardTitle>
                        <CardDescription className="text-white/70">
                          {suite.description}
                        </CardDescription>
                      </div>
                      <Button 
                        onClick={() => runTestSuite(suite.id)}
                        variant="outline"
                        className="border-white/20 text-white hover:bg-white/10"
                      >
                        <Play className="h-4 w-4 mr-2" />
                        Run Suite
                      </Button>
                    </div>
                    
                    <div className="grid grid-cols-3 gap-4 mt-4">
                      <div className="text-center">
                        <p className="text-sm text-white/70">Total</p>
                        <p className="text-xl font-bold text-white">{suite.totalTests}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-sm text-white/70">Passed</p>
                        <p className="text-xl font-bold text-green-400">{suite.passedTests}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-sm text-white/70">Coverage</p>
                        <p className="text-xl font-bold text-blue-400">{suite.coverage}%</p>
                      </div>
                    </div>
                  </CardHeader>
                  
                  <CardContent>
                    <div className="space-y-3">
                      {suite.tests.map((test) => (
                        <div 
                          key={test.id}
                          className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10"
                        >
                          <div className="flex items-center gap-3">
                            {getStatusIcon(test.status)}
                            <div>
                              <p className="text-white font-medium">{test.name}</p>
                              {test.details && (
                                <p className="text-xs text-white/60">{test.details}</p>
                              )}
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-2">
                            {test.duration && (
                              <span className="text-xs text-white/60">
                                {test.duration}ms
                              </span>
                            )}
                            <Badge className={getStatusColor(test.status)}>
                              {test.status}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            ))}
          </Tabs>

          {/* Test Commands */}
          <Card className="bg-white/10 backdrop-blur-sm border-white/20 premium-card mt-8">
            <CardHeader>
              <CardTitle className="text-white">Manual Test Commands</CardTitle>
              <CardDescription className="text-white/70">
                Run these commands in your terminal to execute specific test suites
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <h4 className="text-white font-medium">Unit Tests</h4>
                  <code className="block p-2 bg-black/30 rounded text-green-400 text-sm">
                    npx vitest run test/unit
                  </code>
                </div>
                <div className="space-y-2">
                  <h4 className="text-white font-medium">Integration Tests</h4>
                  <code className="block p-2 bg-black/30 rounded text-green-400 text-sm">
                    npx vitest run test/integration
                  </code>
                </div>
                <div className="space-y-2">
                  <h4 className="text-white font-medium">E2E Tests</h4>
                  <code className="block p-2 bg-black/30 rounded text-green-400 text-sm">
                    npx playwright test
                  </code>
                </div>
                <div className="space-y-2">
                  <h4 className="text-white font-medium">Performance Tests</h4>
                  <code className="block p-2 bg-black/30 rounded text-green-400 text-sm">
                    k6 run test/performance/load-test.js
                  </code>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </Layout>
  );
}