import { createContext, ReactNode, startTransition, useContext, useEffect, useState } from "react";
import {
  useQuery,
  useMutation,
  UseMutationResult,
} from "@tanstack/react-query";
import { User as SelectUser, InsertUser, RegisterPayload } from "@shared/schema";
import { getQueryFn, apiRequest, queryClient } from "../lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { captureFrontendException, setMonitoringUser, shouldCaptureClientError } from "@/lib/monitoring";

type RegisterResponse = {
  message: string;
  requiresVerification?: boolean;
} | SelectUser;

type AuthContextType = {
  user: SelectUser | null;
  isLoading: boolean;
  error: Error | null;
  loginMutation: UseMutationResult<SelectUser, Error, LoginData>;
  logoutMutation: UseMutationResult<void, Error, void>;
  registerMutation: UseMutationResult<RegisterResponse, Error, RegisterPayload>;
};

type ExpectedRole = 'candidate' | 'recruiter' | 'super_admin' | 'hiring_manager';
type LoginData = Pick<InsertUser, "username" | "password"> & {
  expectedRole?: ExpectedRole | ExpectedRole[];
};

export const AuthContext = createContext<AuthContextType | null>(null);

function isPublicSsrPath(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === "/features" ||
    pathname === "/pricing" ||
    pathname === "/solutions" ||
    pathname === "/jobs" ||
    pathname.startsWith("/jobs/") ||
    pathname === "/recruiters" ||
    pathname.startsWith("/recruiters/") ||
    pathname === "/privacy-policy" ||
    pathname === "/terms-of-service" ||
    pathname === "/cookie-policy"
  );
}

function shouldDelayInitialAuthBootstrap(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return false;
  }

  const rootEl = document.getElementById("root");
  if (!rootEl?.hasAttribute("data-ssr")) {
    return false;
  }

  return isPublicSsrPath(window.location.pathname);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast();
  const [authQueryEnabled, setAuthQueryEnabled] = useState(() => !shouldDelayInitialAuthBootstrap());
  const {
    data: user,
    error,
    isLoading,
  } = useQuery<SelectUser | null, Error>({
    queryKey: ["/api/user"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: authQueryEnabled,
  });

  useEffect(() => {
    if (!authQueryEnabled) {
      startTransition(() => {
        setAuthQueryEnabled(true);
      });
    }
  }, [authQueryEnabled]);

  useEffect(() => {
    setMonitoringUser(user ? { id: user.id, role: user.role } : null);
  }, [user]);

  const loginMutation = useMutation({
    mutationFn: async (credentials: LoginData) => {
      const res = await apiRequest("POST", "/api/login", credentials);
      return await res.json();
    },
    onSuccess: (user: SelectUser) => {
      queryClient.setQueryData(["/api/user"], user);
      toast({
        title: "Login successful",
        description: "Welcome back!",
      });
    },
    onError: (error: Error) => {
      if (shouldCaptureClientError(error)) {
        captureFrontendException(error, {
          area: "auth",
          action: "login",
        });
      }
      toast({
        title: "Login failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const registerMutation = useMutation({
    mutationFn: async (credentials: RegisterPayload): Promise<RegisterResponse> => {
      const res = await apiRequest("POST", "/api/register", credentials);
      return await res.json();
    },
    onSuccess: (response: RegisterResponse) => {
      // Check if this is a verification-required response
      if ('requiresVerification' in response && response.requiresVerification) {
        toast({
          title: "Check your email",
          description: response.message || "Please verify your email address to continue.",
        });
        // Don't set user - they need to verify first
        return;
      }
      // Legacy response (user object) - should not happen with new backend
      queryClient.setQueryData(["/api/user"], response);
      toast({
        title: "Registration successful",
        description: "Welcome to VantaHire!",
      });
    },
    onError: (error: Error) => {
      if (shouldCaptureClientError(error)) {
        captureFrontendException(error, {
          area: "auth",
          action: "register",
        });
      }
      toast({
        title: "Registration failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/logout");
    },
    onSuccess: () => {
      queryClient.setQueryData(["/api/user"], null);
      toast({
        title: "Logged out",
        description: "See you soon!",
      });
    },
    onError: (error: Error) => {
      if (shouldCaptureClientError(error)) {
        captureFrontendException(error, {
          area: "auth",
          action: "logout",
        });
      }
      toast({
        title: "Logout failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <AuthContext.Provider
      value={{
        user: user ?? null,
        isLoading,
        error,
        loginMutation,
        logoutMutation,
        registerMutation,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
