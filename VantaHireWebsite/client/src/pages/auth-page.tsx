import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Redirect } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UserPlus, LogIn, Briefcase, Users, Star, Shield, Rocket } from "lucide-react";
import Layout from "@/components/Layout";

export default function AuthPage() {
  const { user, loginMutation, registerMutation } = useAuth();
  const [loginData, setLoginData] = useState({ username: "", password: "" });
  const [registerData, setRegisterData] = useState({
    username: "",
    password: "",
    firstName: "",
    lastName: "",
    role: "recruiter"
  });
  const [isVisible, setIsVisible] = useState(false);

  // Fade-in animation on mount
  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 200);
    return () => clearTimeout(timer);
  }, []);

  // Redirect if already logged in
  if (user) {
    return <Redirect to="/jobs" />;
  }

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    loginMutation.mutate(loginData);
  };

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    registerMutation.mutate(registerData);
  };

  return (
    <Layout>
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex">
        {/* Premium background effects */}
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHZpZXdCb3g9IjAgMCAyMCAyMCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIxIiBjeT0iMSIgcj0iMSIgZmlsbD0id2hpdGUiIGZpbGwtb3BhY2l0eT0iMC4wNSIvPjwvc3ZnPg==')] opacity-10"></div>
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-[100px] animate-pulse-slow"></div>
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-[100px] animate-pulse-slow" style={{ animationDelay: '1.2s' }}></div>
        
        {/* Left Side - Auth Forms */}
        <div className={`flex-1 flex items-center justify-center p-8 relative z-10 transition-opacity duration-1000 ${isVisible ? 'opacity-100' : 'opacity-0'}`}>
          <div className="w-full max-w-md">
            <div className="text-center mb-8 animate-fade-in">
              <div className="w-20 h-1.5 bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] rounded-full mx-auto mb-6"></div>
              <h1 className="text-3xl md:text-4xl font-bold animate-gradient-text mb-2">VantaHire</h1>
              <p className="text-white/70 text-lg">Join our AI-powered recruitment platform</p>
            </div>

            <Tabs defaultValue="login" className="w-full animate-slide-up" style={{ animationDelay: '0.2s' }}>
              <TabsList className="grid w-full grid-cols-2 bg-white/10 backdrop-blur-sm border border-white/20">
                <TabsTrigger value="login" className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-[#7B38FB] data-[state=active]:to-[#FF5BA8] text-white data-[state=active]:text-white transition-all duration-300">
                Login
              </TabsTrigger>
              <TabsTrigger value="register" className="data-[state=active]:bg-white/20 text-white">
                Register
              </TabsTrigger>
            </TabsList>

            <TabsContent value="login">
              <Card className="bg-white/10 backdrop-blur-sm border-white/20">
                <CardHeader>
                  <CardTitle className="text-white flex items-center gap-2">
                    <LogIn className="h-5 w-5" />
                    Welcome Back
                  </CardTitle>
                  <CardDescription className="text-gray-300">
                    Sign in to your recruiter account
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleLogin} className="space-y-4">
                    <div>
                      <Label htmlFor="login-username" className="text-white">Username</Label>
                      <Input
                        id="login-username"
                        type="text"
                        value={loginData.username}
                        onChange={(e) => setLoginData({ ...loginData, username: e.target.value })}
                        required
                        className="bg-white/5 border-white/20 text-white placeholder:text-gray-400"
                        placeholder="Enter your username"
                      />
                    </div>

                    <div>
                      <Label htmlFor="login-password" className="text-white">Password</Label>
                      <Input
                        id="login-password"
                        type="password"
                        value={loginData.password}
                        onChange={(e) => setLoginData({ ...loginData, password: e.target.value })}
                        required
                        className="bg-white/5 border-white/20 text-white placeholder:text-gray-400"
                        placeholder="Enter your password"
                      />
                    </div>

                    <Button
                      type="submit"
                      disabled={loginMutation.isPending}
                      className="w-full bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600"
                    >
                      {loginMutation.isPending ? "Signing in..." : "Sign In"}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="register">
              <Card className="bg-white/10 backdrop-blur-sm border-white/20">
                <CardHeader>
                  <CardTitle className="text-white flex items-center gap-2">
                    <UserPlus className="h-5 w-5" />
                    Create Account
                  </CardTitle>
                  <CardDescription className="text-gray-300">
                    Join VantaHire as a recruiter
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleRegister} className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="firstName" className="text-white">First Name</Label>
                        <Input
                          id="firstName"
                          type="text"
                          value={registerData.firstName}
                          onChange={(e) => setRegisterData({ ...registerData, firstName: e.target.value })}
                          className="bg-white/5 border-white/20 text-white placeholder:text-gray-400"
                          placeholder="John"
                        />
                      </div>
                      <div>
                        <Label htmlFor="lastName" className="text-white">Last Name</Label>
                        <Input
                          id="lastName"
                          type="text"
                          value={registerData.lastName}
                          onChange={(e) => setRegisterData({ ...registerData, lastName: e.target.value })}
                          className="bg-white/5 border-white/20 text-white placeholder:text-gray-400"
                          placeholder="Doe"
                        />
                      </div>
                    </div>

                    <div>
                      <Label htmlFor="register-username" className="text-white">Username *</Label>
                      <Input
                        id="register-username"
                        type="text"
                        value={registerData.username}
                        onChange={(e) => setRegisterData({ ...registerData, username: e.target.value })}
                        required
                        className="bg-white/5 border-white/20 text-white placeholder:text-gray-400"
                        placeholder="Choose a username"
                      />
                    </div>

                    <div>
                      <Label htmlFor="register-password" className="text-white">Password *</Label>
                      <Input
                        id="register-password"
                        type="password"
                        value={registerData.password}
                        onChange={(e) => setRegisterData({ ...registerData, password: e.target.value })}
                        required
                        className="bg-white/5 border-white/20 text-white placeholder:text-gray-400"
                        placeholder="Create a strong password"
                      />
                    </div>

                    <div>
                      <Label htmlFor="role" className="text-white">Role</Label>
                      <Select value={registerData.role} onValueChange={(value) => setRegisterData({ ...registerData, role: value })}>
                        <SelectTrigger className="bg-white/5 border-white/20 text-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="recruiter">Recruiter</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <Button
                      type="submit"
                      disabled={registerMutation.isPending}
                      className="w-full bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600"
                    >
                      {registerMutation.isPending ? "Creating account..." : "Create Account"}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Right Side - Hero Section */}
      <div className="flex-1 flex items-center justify-center p-8 bg-gradient-to-br from-purple-600/20 to-blue-600/20">
        <div className="text-center max-w-lg">
          <div className="mb-8">
            <div className="inline-flex items-center justify-center w-24 h-24 bg-gradient-to-r from-purple-500 to-blue-500 rounded-full mb-6">
              <Briefcase className="h-12 w-12 text-white" />
            </div>
            <h2 className="text-4xl font-bold text-white mb-4">
              Power Your Recruitment
            </h2>
            <p className="text-xl text-gray-300 mb-8">
              Join VantaHire's AI-powered platform to find the best talent and streamline your hiring process.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6">
            <div className="flex items-center gap-4 text-left">
              <div className="flex-shrink-0 w-12 h-12 bg-purple-500/20 rounded-lg flex items-center justify-center">
                <Users className="h-6 w-6 text-purple-300" />
              </div>
              <div>
                <h3 className="text-white font-semibold mb-1">Smart Matching</h3>
                <p className="text-gray-300 text-sm">AI-powered candidate matching for better hiring decisions</p>
              </div>
            </div>

            <div className="flex items-center gap-4 text-left">
              <div className="flex-shrink-0 w-12 h-12 bg-blue-500/20 rounded-lg flex items-center justify-center">
                <Briefcase className="h-6 w-6 text-blue-300" />
              </div>
              <div>
                <h3 className="text-white font-semibold mb-1">Job Management</h3>
                <p className="text-gray-300 text-sm">Post jobs, track applications, and manage candidates efficiently</p>
              </div>
            </div>

            <div className="flex items-center gap-4 text-left">
              <div className="flex-shrink-0 w-12 h-12 bg-pink-500/20 rounded-lg flex items-center justify-center">
                <LogIn className="h-6 w-6 text-pink-300" />
              </div>
              <div>
                <h3 className="text-white font-semibold mb-1">Seamless Experience</h3>
                <p className="text-gray-300 text-sm">Intuitive platform designed for modern recruitment teams</p>
              </div>
            </div>
          </div>
        </div>
      </div>
      </div>
    </Layout>
  );
}