import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Search, FileText, Star, MessageCircle } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

export default function CandidateAuth() {
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
    role: "candidate"
  });

  // Redirect if already logged in as candidate
  useEffect(() => {
    if (user && user.role === "candidate") {
      setLocation("/");
    } else if (user && user.role !== "candidate") {
      toast({
        title: "Access Denied",
        description: "This login is for candidates only. Please use the recruiter login.",
        variant: "destructive",
      });
      setLocation("/recruiter-auth");
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
                Find Your Dream Job
              </h1>
              <p className="text-xl text-white/80 leading-relaxed">
                Join thousands of professionals who have found their perfect career match through VantaHire's advanced job platform.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="flex items-start space-x-4">
                <div className="flex-shrink-0">
                  <Search className="h-8 w-8 text-[#7B38FB]" />
                </div>
                <div>
                  <h3 className="text-white font-semibold mb-2">Smart Job Search</h3>
                  <p className="text-white/70 text-sm">Find opportunities that match your skills and preferences</p>
                </div>
              </div>

              <div className="flex items-start space-x-4">
                <div className="flex-shrink-0">
                  <FileText className="h-8 w-8 text-[#FF5BA8]" />
                </div>
                <div>
                  <h3 className="text-white font-semibold mb-2">Easy Applications</h3>
                  <p className="text-white/70 text-sm">Apply to multiple jobs with one-click applications</p>
                </div>
              </div>

              <div className="flex items-start space-x-4">
                <div className="flex-shrink-0">
                  <Star className="h-8 w-8 text-[#00D2FF]" />
                </div>
                <div>
                  <h3 className="text-white font-semibold mb-2">Profile Building</h3>
                  <p className="text-white/70 text-sm">Create a standout profile that attracts employers</p>
                </div>
              </div>

              <div className="flex items-start space-x-4">
                <div className="flex-shrink-0">
                  <MessageCircle className="h-8 w-8 text-[#90EE90]" />
                </div>
                <div>
                  <h3 className="text-white font-semibold mb-2">Real-time Updates</h3>
                  <p className="text-white/70 text-sm">Get notified about application status and new opportunities</p>
                </div>
              </div>
            </div>

            <div className="pt-4">
              <p className="text-white/60 text-sm">
                Are you a recruiter? <Button variant="link" className="text-[#7B38FB] p-0 h-auto" onClick={() => setLocation("/recruiter-auth")}>
                  Go to Recruiter Login
                </Button>
              </p>
            </div>
          </div>

          {/* Right Column - Auth Form */}
          <div className="flex justify-center">
            <Card className="w-full max-w-md bg-white/10 backdrop-blur-sm border-white/20">
              <CardHeader className="text-center">
                <CardTitle className="text-white text-2xl">Candidate Access</CardTitle>
                <CardDescription className="text-white/70">
                  Sign in to your account or create a new profile
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
                        {registerMutation.isPending ? "Creating account..." : "Create Account"}
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