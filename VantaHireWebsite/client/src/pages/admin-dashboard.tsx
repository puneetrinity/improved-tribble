import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BarChart3, Users, Briefcase, TrendingUp, Shield, Eye, CheckCircle, Clock } from "lucide-react";
import Layout from "@/components/Layout";
import { useAuth } from "@/hooks/use-auth";
import { Redirect } from "wouter";

interface AdminStats {
  totalJobs: number;
  totalApplications: number;
  totalUsers: number;
  pendingJobs: number;
  activeJobs: number;
  rejectedJobs: number;
}

export default function AdminDashboard() {
  const { user } = useAuth();
  const [isVisible, setIsVisible] = useState(false);

  // Fade-in animation on mount
  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 200);
    return () => clearTimeout(timer);
  }, []);

  // Redirect if not admin
  if (user && user.role !== 'admin') {
    return <Redirect to="/jobs" />;
  }

  const { data: stats, isLoading } = useQuery<AdminStats>({
    queryKey: ["/api/admin/stats"],
    enabled: !!user && user.role === 'admin',
  });

  const statCards = [
    {
      title: "Total Jobs",
      value: stats?.totalJobs || 0,
      icon: Briefcase,
      color: "from-[#7B38FB] to-[#FF5BA8]",
      bgColor: "bg-[#7B38FB]/10",
      description: "All job postings"
    },
    {
      title: "Total Applications",
      value: stats?.totalApplications || 0,
      icon: Users,
      color: "from-[#2D81FF] to-[#7B38FB]",
      bgColor: "bg-[#2D81FF]/10",
      description: "Candidate submissions"
    },
    {
      title: "Active Jobs",
      value: stats?.activeJobs || 0,
      icon: CheckCircle,
      color: "from-green-400 to-emerald-500",
      bgColor: "bg-green-400/10",
      description: "Currently open positions"
    },
    {
      title: "Pending Review",
      value: stats?.pendingJobs || 0,
      icon: Clock,
      color: "from-orange-400 to-yellow-500",
      bgColor: "bg-orange-400/10",
      description: "Awaiting approval"
    }
  ];

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
                <span className="text-white ml-3">Dashboard</span>
              </h1>
            </div>
            <p className="text-lg md:text-xl text-white/80 max-w-2xl leading-relaxed animate-slide-up" style={{ animationDelay: '0.3s' }}>
              Monitor platform performance and manage the VantaHire ecosystem
            </p>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
            {statCards.map((stat, index) => (
              <Card 
                key={stat.title}
                className="bg-white/10 backdrop-blur-sm border-white/20 premium-card group animate-slide-up"
                style={{ animationDelay: `${0.5 + index * 0.1}s` }}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className={`p-3 rounded-lg ${stat.bgColor} group-hover:scale-110 transition-transform duration-300`}>
                      <stat.icon className="h-6 w-6 text-white" />
                    </div>
                    <Badge variant="outline" className="bg-white/5 border-white/20 text-white/70">
                      {isLoading ? "..." : "Live"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <h3 className="text-2xl md:text-3xl font-bold text-white group-hover:tracking-wide transition-all duration-300">
                      {isLoading ? "..." : stat.value.toLocaleString()}
                    </h3>
                    <p className="font-medium text-white/90">{stat.title}</p>
                    <p className="text-sm text-white/60">{stat.description}</p>
                  </div>
                  <div className={`h-1 w-full bg-gradient-to-r ${stat.color} rounded-full mt-4 opacity-60 group-hover:opacity-100 transition-opacity`}></div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Quick Actions */}
          <Card className="mb-8 bg-white/10 backdrop-blur-sm border-white/20 premium-card animate-slide-up" style={{ animationDelay: '0.9s' }}>
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-[#7B38FB]" />
                Quick Actions
              </CardTitle>
              <CardDescription className="text-white/70">
                Common administrative tasks and platform management
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Button 
                  className="bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] hover:shadow-lg hover:shadow-purple-500/20 transition-all duration-300 hover:scale-105 h-12"
                  onClick={() => window.location.href = '/admin/super'}
                >
                  <Shield className="h-4 w-4 mr-2" />
                  Super Admin
                </Button>
                
                <Button 
                  variant="outline" 
                  className="border-white/20 text-white hover:bg-white/10 h-12"
                  onClick={() => window.location.href = '/admin/jobs'}
                >
                  <Eye className="h-4 w-4 mr-2" />
                  Review Jobs
                </Button>
                
                <Button 
                  variant="outline" 
                  className="border-white/20 text-white hover:bg-white/10 h-12"
                  onClick={() => window.location.href = '/analytics'}
                >
                  <TrendingUp className="h-4 w-4 mr-2" />
                  Analytics
                </Button>
                
                <Button 
                  variant="outline" 
                  className="border-white/20 text-white hover:bg-white/10 h-12"
                  onClick={() => window.location.href = '/admin/users'}
                >
                  <Users className="h-4 w-4 mr-2" />
                  Manage Users
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Recent Activity */}
          <Card className="bg-white/10 backdrop-blur-sm border-white/20 premium-card animate-slide-up" style={{ animationDelay: '1.1s' }}>
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Clock className="h-5 w-5 text-[#2D81FF]" />
                Recent Platform Activity
              </CardTitle>
              <CardDescription className="text-white/70">
                Latest updates and system events
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center gap-4 p-4 bg-white/5 rounded-lg border border-white/10">
                  <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                  <div className="flex-1">
                    <p className="text-white/90 font-medium">Platform Status: Operational</p>
                    <p className="text-white/60 text-sm">All systems running normally</p>
                  </div>
                  <Badge className="bg-green-400/20 text-green-300 border-green-400/30">
                    Healthy
                  </Badge>
                </div>
                
                <div className="flex items-center gap-4 p-4 bg-white/5 rounded-lg border border-white/10">
                  <div className="w-2 h-2 bg-blue-400 rounded-full"></div>
                  <div className="flex-1">
                    <p className="text-white/90 font-medium">Job Analytics Updated</p>
                    <p className="text-white/60 text-sm">Performance metrics refreshed</p>
                  </div>
                  <Badge variant="outline" className="bg-blue-400/20 text-blue-300 border-blue-400/30">
                    Recent
                  </Badge>
                </div>
                
                <div className="flex items-center gap-4 p-4 bg-white/5 rounded-lg border border-white/10">
                  <div className="w-2 h-2 bg-purple-400 rounded-full"></div>
                  <div className="flex-1">
                    <p className="text-white/90 font-medium">AI Analysis Active</p>
                    <p className="text-white/60 text-sm">Job optimization engine running</p>
                  </div>
                  <Badge variant="outline" className="bg-purple-400/20 text-purple-300 border-purple-400/30">
                    Active
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </Layout>
  );
}