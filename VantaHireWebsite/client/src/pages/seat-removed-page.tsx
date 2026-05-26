import { useAuth } from "@/hooks/use-auth";
import { useOrganization } from "@/hooks/use-organization";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, Mail, LogOut } from "lucide-react";
import { useLocation } from "wouter";
import { Helmet } from "react-helmet-async";
import Layout from "@/components/Layout";

/**
 * Page shown to users whose seat has been removed from their organization.
 * They remain members but cannot access the dashboard until re-seated.
 */
export default function SeatRemovedPage() {
  const { user, logoutMutation } = useAuth();
  const { data: orgData } = useOrganization();
  const [, setLocation] = useLocation();

  const handleLogout = async () => {
    await logoutMutation.mutateAsync();
    setLocation("/");
  };

  const handleLeaveOrg = () => {
    setLocation("/org/settings");
  };

  const orgName = orgData?.organization?.name || "your organization";

  return (
    <Layout>
      <Helmet>
        <title>Seat Removed | ealana</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="mx-auto w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mb-4">
              <AlertCircle className="h-8 w-8 text-amber-600" />
            </div>
            <CardTitle className="text-2xl">Seat Removed</CardTitle>
            <CardDescription>
              Your access to {orgName} has been temporarily suspended
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="bg-muted/50 rounded-lg p-4 text-sm text-muted-foreground">
              <p>
                Your organization has reduced its seat count, and your seat has been removed.
                You are still a member of {orgName}, but you cannot access the dashboard until
                a seat is reassigned to you.
              </p>
            </div>

            <div className="space-y-3">
              <p className="text-sm font-medium">What you can do:</p>
              <ul className="text-sm text-muted-foreground space-y-2">
                <li className="flex items-start gap-2">
                  <Mail className="h-4 w-4 mt-0.5 text-primary" />
                  Contact your organization owner to request a seat
                </li>
                <li className="flex items-start gap-2">
                  <LogOut className="h-4 w-4 mt-0.5 text-primary" />
                  Leave the organization to join another one
                </li>
              </ul>
            </div>

            <div className="flex flex-col gap-3 pt-4">
              <Button variant="outline" onClick={handleLeaveOrg}>
                Organization Settings
              </Button>
              <Button variant="ghost" onClick={handleLogout}>
                <LogOut className="h-4 w-4 mr-2" />
                Sign Out
              </Button>
            </div>

            {user && (
              <p className="text-xs text-center text-muted-foreground">
                Signed in as {user.username}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
