import { createContext, ReactNode, startTransition, useContext, useEffect, useState } from "react";
import {
  useQuery,
  useMutation,
  UseMutationResult,
} from "@tanstack/react-query";
import { User as SelectUser, InsertUser, RegisterPayload } from "@shared/schema";
import {
  getQueryFn,
  apiRequest,
  clearUserScopedQueryCache,
  queryClient,
} from "../lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { captureFrontendException, setMonitoringUser, shouldCaptureClientError } from "@/lib/monitoring";

type RegisterResponse = {
  message: string;
  requiresVerification?: boolean;
  user?: SelectUser;
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

const authQueryKey = ["/api/user"] as const;
const crossTabAuthSignalStorageKey = "ealana:auth-identity-change";
const fetchAuthUser = getQueryFn<SelectUser | null>({ on401: "returnNull" });

function publishCrossTabAuthIdentityChange(): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      crossTabAuthSignalStorageKey,
      `${Date.now()}:${Math.random().toString(36).slice(2)}`,
    );
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
}

function clearCacheForAuthIdentity(nextUser: SelectUser | null): void {
  const currentUser = queryClient.getQueryData<SelectUser | null>(authQueryKey);
  if ((currentUser?.id ?? null) !== (nextUser?.id ?? null)) {
    clearUserScopedQueryCache();
  }
}

function setCachedAuthUser(nextUser: SelectUser | null): void {
  clearCacheForAuthIdentity(nextUser);
  queryClient.setQueryData(authQueryKey, nextUser);
  publishCrossTabAuthIdentityChange();
}

function isPublicSsrPath(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === "/features" ||
    pathname === "/about" ||
    pathname === "/what-is-decision-intelligence" ||
    pathname === "/talent-intelligence-vs-ats" ||
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
    queryKey: authQueryKey,
    queryFn: async (context) => {
      const nextUser = await fetchAuthUser(context);
      clearCacheForAuthIdentity(nextUser);
      return nextUser;
    },
    enabled: authQueryEnabled,
    staleTime: 30_000,
    refetchOnWindowFocus: "always",
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

  useEffect(() => {
    const handleCrossTabAuthIdentityChange = (event: StorageEvent) => {
      if (event.key !== crossTabAuthSignalStorageKey) return;

      clearUserScopedQueryCache();
      queryClient.setQueryData(authQueryKey, null);
      window.location.reload();
    };

    window.addEventListener("storage", handleCrossTabAuthIdentityChange);
    return () => {
      window.removeEventListener("storage", handleCrossTabAuthIdentityChange);
    };
  }, []);

  const loginMutation = useMutation({
    mutationFn: async (credentials: LoginData) => {
      const res = await apiRequest("POST", "/api/login", credentials);
      return await res.json();
    },
    onSuccess: (user: SelectUser) => {
      setCachedAuthUser(user);
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

      if ('user' in response && response.user) {
        setCachedAuthUser(response.user);
      } else if ('id' in response) {
        setCachedAuthUser(response);
      } else {
        void queryClient.invalidateQueries({ queryKey: authQueryKey });
        publishCrossTabAuthIdentityChange();
      }
      toast({
        title: "Registration successful",
        description: "Welcome to ealana!",
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
      setCachedAuthUser(null);
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
