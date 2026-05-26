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
    const timer = setTimeout(() => setIsVisible(true), 100);
    return () => clearTimeout(timer);
  }, []);

  // Redirect if not admin
  if (user && user.role !== 'super_admin') {
    return <Redirect to="/jobs" />;
  }

  const { data: stats, isLoading } = useQuery<AdminStats>({
    queryKey: ["/api/admin/stats"],
    enabled: !!user && user.role === 'super_admin',
  });

  const statCards = [
    {
      title: "Total Jobs",
      value: stats?.totalJobs || 0,
      icon: Briefcase,
      iconColor: "text-primary",
      bgColor: "bg-primary/10",
      description: "All job postings"
    },
    {
      title: "Total Applications",
      value: stats?.totalApplications || 0,
      icon: Users,
      iconColor: "text-info",
      bgColor: "bg-info/10",
      description: "Candidate submissions"
    },
    {
      title: "Active Jobs",
      value: stats?.activeJobs || 0,
      icon: CheckCircle,
      iconColor: "text-success",
      bgColor: "bg-success/10",
      description: "Currently open positions"
    },
    {
      title: "Pending Review",
      value: stats?.pendingJobs || 0,
      icon: Clock,
      iconColor: "text-warning",
      bgColor: "bg-warning/10",
      description: "Awaiting approval"
    }
  ];

  return (
    <Layout>
      <div className={`container mx-auto px-4 py-8 transition-opacity duration-500 ${isVisible ? 'opacity-100' : 'opacity-0'}`}>
        {/* Header */}
        <div className="mb-8 pt-8">
          <div className="flex items-center gap-3 mb-2">
            <Shield className="h-7 w-7 text-primary" />
            <h1 className="text-2xl md:text-3xl font-semibold text-foreground">
              Admin Dashboard
            </h1>
          </div>
          <p className="text-muted-foreground text-sm md:text-base max-w-2xl">
            Monitor platform performance and manage the ealana ecosystem
          </p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {statCards.map((stat) => (
            <Card key={stat.title} className="shadow-sm hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className={`p-3 rounded-lg ${stat.bgColor}`}>
                    <stat.icon className={`h-5 w-5 ${stat.iconColor}`} />
                  </div>
                  <Badge variant="secondary" className="bg-muted text-muted-foreground border-border">
                    {isLoading ? "..." : "Live"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-1">
                  <h3 className="text-2xl md:text-3xl font-bold text-foreground">
                    {isLoading ? "..." : stat.value.toLocaleString()}
                  </h3>
                  <p className="font-medium text-foreground">{stat.title}</p>
                  <p className="text-sm text-muted-foreground">{stat.description}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Quick Actions */}
        <Card className="mb-8 shadow-sm">
          <CardHeader>
            <CardTitle className="text-foreground flex items-center gap-2 text-lg">
              <BarChart3 className="h-5 w-5 text-primary" />
              Quick Actions
            </CardTitle>
            <CardDescription>
              Common administrative tasks and platform management
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <Button
                className="h-11"
                onClick={() => window.location.href = '/admin/super'}
              >
                <Shield className="h-4 w-4 mr-2" />
                Super Admin
              </Button>

              <Button
                variant="outline"
                className="h-11"
                onClick={() => window.location.href = '/admin'}
              >
                <Eye className="h-4 w-4 mr-2" />
                Review Jobs
              </Button>

              <Button
                variant="outline"
                className="h-11"
                onClick={() => window.location.href = '/analytics'}
              >
                <TrendingUp className="h-4 w-4 mr-2" />
                Analytics
              </Button>

              <Button
                variant="outline"
                className="h-11"
                onClick={() => window.location.href = '/admin/users'}
              >
                <Users className="h-4 w-4 mr-2" />
                Manage Users
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-foreground flex items-center gap-2 text-lg">
              <Clock className="h-5 w-5 text-info" />
              Recent Platform Activity
            </CardTitle>
            <CardDescription>
              Latest updates and system events
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center gap-4 p-4 bg-muted/50 rounded-lg border border-border">
                <div className="w-2 h-2 bg-success/100 rounded-full"></div>
                <div className="flex-1">
                  <p className="text-foreground font-medium">Platform Status: Operational</p>
                  <p className="text-muted-foreground text-sm">All systems running normally</p>
                </div>
                <Badge className="bg-success/10 text-success-foreground border-success/30">
                  Healthy
                </Badge>
              </div>

              <div className="flex items-center gap-4 p-4 bg-muted/50 rounded-lg border border-border">
                <div className="w-2 h-2 bg-info/100 rounded-full"></div>
                <div className="flex-1">
                  <p className="text-foreground font-medium">Job Analytics Updated</p>
                  <p className="text-muted-foreground text-sm">Performance metrics refreshed</p>
                </div>
                <Badge variant="outline" className="bg-info/10 text-info-foreground border-info/30">
                  Recent
                </Badge>
              </div>

              <div className="flex items-center gap-4 p-4 bg-muted/50 rounded-lg border border-border">
                <div className="w-2 h-2 bg-primary rounded-full"></div>
                <div className="flex-1">
                  <p className="text-foreground font-medium">AI Analysis Active</p>
                  <p className="text-muted-foreground text-sm">Job optimization engine running</p>
                </div>
                <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">
                  Active
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
