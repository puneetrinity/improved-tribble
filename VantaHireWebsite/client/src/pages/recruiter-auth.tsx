import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Briefcase, Users, TrendingUp, Shield } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

export default function RecruiterAuth() {
  const { user, loginMutation, registerMutation } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  const [loginData, setLoginData] = useState({
    username: "",
    password: ""
  });
  
  const [registerData, setRegisterData] = useState({
    username: "",
    password: "",
    firstName: "",
    lastName: "",
    role: "recruiter"
  });

  // Redirect if already logged in as recruiter
  useEffect(() => {
    if (user && user.role === "recruiter") {
      setLocation("/recruiter-dashboard");
    } else if (user && user.role !== "recruiter") {
      toast({
        title: "Access Denied",
        description: "This login is for recruiters only. Please use the candidate login.",
        variant: "destructive",
      });
      setLocation("/candidate-auth");
    }
  }, [user, setLocation, toast]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    loginMutation.mutate(loginData);
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    registerMutation.mutate(registerData);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1E0B40] via-[#2D1B69] to-[#1E0B40]">
      <Header />
      <div className="container mx-auto px-4 pt-32 pb-16">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          {/* Left Column - Hero Content */}
          <div className="space-y-8">
            <div className="space-y-4">
              <h1 className="text-4xl md:text-5xl font-bold text-white leading-tight">
                Recruiter Portal
              </h1>
              <p className="text-xl text-white/80 leading-relaxed">
                Access powerful tools to manage your job postings, review applications, and find the perfect candidates for your organization.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="flex items-start space-x-4">
                <div className="flex-shrink-0">
                  <Briefcase className="h-8 w-8 text-[#7B38FB]" />
                </div>
                <div>
                  <h3 className="text-white font-semibold mb-2">Job Management</h3>
                  <p className="text-white/70 text-sm">Post, edit, and manage your job listings with ease</p>
                </div>
              </div>

              <div className="flex items-start space-x-4">
                <div className="flex-shrink-0">
                  <Users className="h-8 w-8 text-[#FF5BA8]" />
                </div>
                <div>
                  <h3 className="text-white font-semibold mb-2">Application Review</h3>
                  <p className="text-white/70 text-sm">Review, shortlist, and manage candidate applications</p>
                </div>
              </div>

              <div className="flex items-start space-x-4">
                <div className="flex-shrink-0">
                  <TrendingUp className="h-8 w-8 text-[#00D2FF]" />
                </div>
                <div>
                  <h3 className="text-white font-semibold mb-2">Analytics</h3>
                  <p className="text-white/70 text-sm">Track job performance and application metrics</p>
                </div>
              </div>

              <div className="flex items-start space-x-4">
                <div className="flex-shrink-0">
                  <Shield className="h-8 w-8 text-[#90EE90]" />
                </div>
                <div>
                  <h3 className="text-white font-semibold mb-2">Secure Access</h3>
                  <p className="text-white/70 text-sm">Enterprise-grade security for your recruitment data</p>
                </div>
              </div>
            </div>

            <div className="pt-4">
              <p className="text-white/60 text-sm">
                Looking for candidate access? <Button variant="link" className="text-[#7B38FB] p-0 h-auto" onClick={() => setLocation("/candidate-auth")}>
                  Go to Candidate Login
                </Button>
              </p>
            </div>
          </div>

          {/* Right Column - Auth Form */}
          <div className="flex justify-center">
            <Card className="w-full max-w-md bg-white/10 backdrop-blur-sm border-white/20">
              <CardHeader className="text-center">
                <CardTitle className="text-white text-2xl">Recruiter Access</CardTitle>
                <CardDescription className="text-white/70">
                  Sign in to your recruiter account or create a new one
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="login" className="space-y-6">
                  <TabsList className="grid w-full grid-cols-2 bg-white/10">
                    <TabsTrigger value="login" className="data-[state=active]:bg-white/20 text-white">
                      Sign In
                    </TabsTrigger>
                    <TabsTrigger value="register" className="data-[state=active]:bg-white/20 text-white">
                      Register
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="login">
                    <form onSubmit={handleLogin} className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="username" className="text-white">Username</Label>
                        <Input
                          id="username"
                          type="text"
                          value={loginData.username}
                          onChange={(e) => setLoginData(prev => ({ ...prev, username: e.target.value }))}
                          className="bg-white/5 border-white/20 text-white placeholder:text-white/50"
                          placeholder="Enter your username"
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="password" className="text-white">Password</Label>
                        <Input
                          id="password"
                          type="password"
                          value={loginData.password}
                          onChange={(e) => setLoginData(prev => ({ ...prev, password: e.target.value }))}
                          className="bg-white/5 border-white/20 text-white placeholder:text-white/50"
                          placeholder="Enter your password"
                          required
                        />
                      </div>
                      <Button
                        type="submit"
                        className="w-full bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] hover:opacity-90"
                        disabled={loginMutation.isPending}
                      >
                        {loginMutation.isPending ? "Signing in..." : "Sign In"}
                      </Button>
                    </form>
                  </TabsContent>

                  <TabsContent value="register">
                    <form onSubmit={handleRegister} className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="firstName" className="text-white">First Name</Label>
                          <Input
                            id="firstName"
                            type="text"
                            value={registerData.firstName}
                            onChange={(e) => setRegisterData(prev => ({ ...prev, firstName: e.target.value }))}
                            className="bg-white/5 border-white/20 text-white placeholder:text-white/50"
                            placeholder="First name"
                            required
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="lastName" className="text-white">Last Name</Label>
                          <Input
                            id="lastName"
                            type="text"
                            value={registerData.lastName}
                            onChange={(e) => setRegisterData(prev => ({ ...prev, lastName: e.target.value }))}
                            className="bg-white/5 border-white/20 text-white placeholder:text-white/50"
                            placeholder="Last name"
                            required
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="regUsername" className="text-white">Username</Label>
                        <Input
                          id="regUsername"
                          type="text"
                          value={registerData.username}
                          onChange={(e) => setRegisterData(prev => ({ ...prev, username: e.target.value }))}
                          className="bg-white/5 border-white/20 text-white placeholder:text-white/50"
                          placeholder="Choose a username"
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="regPassword" className="text-white">Password</Label>
                        <Input
                          id="regPassword"
                          type="password"
                          value={registerData.password}
                          onChange={(e) => setRegisterData(prev => ({ ...prev, password: e.target.value }))}
                          className="bg-white/5 border-white/20 text-white placeholder:text-white/50"
                          placeholder="Create a password"
                          required
                        />
                      </div>
                      <Button
                        type="submit"
                        className="w-full bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] hover:opacity-90"
                        disabled={registerMutation.isPending}
                      >
                        {registerMutation.isPending ? "Creating account..." : "Create Recruiter Account"}
                      </Button>
                    </form>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
}