import { useState } from "react";
import { useLocation } from "wouter";
import Layout from "@/components/Layout";
import { useOrganization } from "@/hooks/use-organization";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  Globe,
  Loader2,
  AlertCircle,
  CheckCircle,
  ArrowLeft,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { orgDomainRequestPageCopy } from "@/lib/internal-copy";
import { apiRequest } from "@/lib/queryClient";

// List of public email domains that cannot be claimed
const PUBLIC_DOMAINS = [
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com',
  'aol.com', 'icloud.com', 'mail.com', 'protonmail.com', 'zoho.com',
  'yandex.com', 'gmx.com', 'fastmail.com', 'tutanota.com', 'pm.me'
];

export default function OrgDomainRequestPage() {
  const { user } = useAuth();
  const { data: orgData, isLoading } = useOrganization();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [domain, setDomain] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isOwner = orgData?.membership?.role === 'owner';

  // Extract domain from user's email
  const userEmailDomain = user?.username?.split('@')[1]?.toLowerCase() || '';
  const isPublicEmailUser = PUBLIC_DOMAINS.includes(userEmailDomain);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const normalizedDomain = domain.trim().toLowerCase();

    if (!normalizedDomain) {
      toast({
        title: orgDomainRequestPageCopy.common.errorTitle,
        description: orgDomainRequestPageCopy.toasts.missingDomain,
        variant: "destructive",
      });
      return;
    }

    // Validate domain format
    const domainRegex = /^[a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,}$/;
    if (!domainRegex.test(normalizedDomain)) {
      toast({
        title: orgDomainRequestPageCopy.toasts.invalidDomainTitle,
        description: orgDomainRequestPageCopy.toasts.invalidDomainDescription,
        variant: "destructive",
      });
      return;
    }

    // Check if it's a public domain
    if (PUBLIC_DOMAINS.includes(normalizedDomain)) {
      toast({
        title: orgDomainRequestPageCopy.toasts.publicDomainTitle,
        description: orgDomainRequestPageCopy.toasts.publicDomainDescription,
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await apiRequest('POST', '/api/organizations/domain/request', { domain: normalizedDomain });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || orgDomainRequestPageCopy.toasts.submitFailed);
      }

      toast({
        title: orgDomainRequestPageCopy.toasts.requestSubmittedTitle,
        description: orgDomainRequestPageCopy.toasts.requestSubmittedDescription,
      });

      setLocation('/org/settings');
    } catch (error: any) {
      toast({
        title: orgDomainRequestPageCopy.common.errorTitle,
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="max-w-7xl mx-auto p-6 flex justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </Layout>
    );
  }

  if (!orgData) {
    return (
      <Layout>
        <div className="max-w-7xl mx-auto p-6">
          <Card>
            <CardContent className="pt-6">
              <p className="text-center text-muted-foreground">
                {orgDomainRequestPageCopy.common.noOrganization}
              </p>
            </CardContent>
          </Card>
        </div>
      </Layout>
    );
  }

  if (!isOwner) {
    return (
      <Layout>
        <div className="max-w-7xl mx-auto p-6">
          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <AlertCircle className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
                <p className="text-muted-foreground">
                  {orgDomainRequestPageCopy.access.ownerOnly}
                </p>
                <Button variant="outline" className="mt-4" onClick={() => setLocation('/org/settings')}>
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  {orgDomainRequestPageCopy.common.backToSettings}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </Layout>
    );
  }

  const org = orgData.organization;

  // If domain is already verified
  if (org.domain && org.domainVerified) {
    return (
      <Layout>
        <div className="max-w-7xl mx-auto p-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-green-500" />
                {orgDomainRequestPageCopy.verified.title}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                <p className="font-medium text-green-800">@{org.domain}</p>
                <p className="text-sm text-green-700 mt-1">
                  {orgDomainRequestPageCopy.verified.description}
                </p>
              </div>
            </CardContent>
            <CardFooter>
              <Button variant="outline" onClick={() => setLocation('/org/settings')}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                {orgDomainRequestPageCopy.common.backToSettings}
              </Button>
            </CardFooter>
          </Card>
        </div>
      </Layout>
    );
  }

  // If there's a pending domain request
  if (org.domain && !org.domainVerified) {
    return (
      <Layout>
        <div className="max-w-7xl mx-auto p-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe className="h-5 w-5" />
              {orgDomainRequestPageCopy.pending.title}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-amber-800">@{org.domain}</p>
                  <p className="text-sm text-amber-700 mt-1">
                    {orgDomainRequestPageCopy.pending.description}
                  </p>
                </div>
                <Badge variant="secondary">{orgDomainRequestPageCopy.pending.badge}</Badge>
              </div>
            </div>
            <p className="text-sm text-muted-foreground mt-4">
              {orgDomainRequestPageCopy.pending.hint}
            </p>
          </CardContent>
          <CardFooter>
            <Button variant="outline" onClick={() => setLocation('/org/settings')}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              {orgDomainRequestPageCopy.common.backToSettings}
            </Button>
          </CardFooter>
        </Card>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-7xl mx-auto p-6 space-y-6">
      <Button variant="ghost" onClick={() => setLocation('/org/settings')}>
        <ArrowLeft className="h-4 w-4 mr-2" />
        {orgDomainRequestPageCopy.common.backToSettings}
      </Button>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            {orgDomainRequestPageCopy.request.title}
          </CardTitle>
          <CardDescription>
            {orgDomainRequestPageCopy.request.description}
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-6">
            {isPublicEmailUser && (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                <div className="flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-amber-800">{orgDomainRequestPageCopy.request.publicEmailTitle}</p>
                    <p className="text-sm text-amber-700 mt-1">
                      {orgDomainRequestPageCopy.request.publicEmailDescription.replace("public email domain.", `public email domain (@${userEmailDomain}).`)}
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="domain">{orgDomainRequestPageCopy.request.companyDomain}</Label>
              <div className="flex items-center">
                <span className="text-muted-foreground mr-1">@</span>
                <Input
                  id="domain"
                  placeholder={orgDomainRequestPageCopy.request.companyDomainPlaceholder}
                  value={domain}
                  onChange={(e) => setDomain(e.target.value.toLowerCase())}
                  className="flex-1"
                />
              </div>
              {!isPublicEmailUser && (
                <p className="text-sm text-muted-foreground">
                  {orgDomainRequestPageCopy.request.suggestedPrefix} <strong>@{userEmailDomain}</strong>
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto p-0 ml-2"
                    onClick={() => setDomain(userEmailDomain)}
                  >
                    {orgDomainRequestPageCopy.request.useThis}
                  </Button>
                </p>
              )}
            </div>

            <div className="p-4 bg-slate-50 rounded-lg space-y-3">
              <h4 className="font-medium">{orgDomainRequestPageCopy.request.nextTitle}</h4>
              <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
                <li>{orgDomainRequestPageCopy.request.nextSteps[0]}</li>
                <li>{orgDomainRequestPageCopy.request.nextSteps[1]}</li>
                <li>{orgDomainRequestPageCopy.request.nextSteps[2].replace("your company email", `@${domain || 'yourdomain.com'} email`)}</li>
                <li>{orgDomainRequestPageCopy.request.nextSteps[3]}</li>
              </ol>
            </div>
          </CardContent>
          <CardFooter className="border-t pt-6">
            <Button type="submit" disabled={isSubmitting || !domain.trim()}>
              {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {orgDomainRequestPageCopy.request.submit}
            </Button>
          </CardFooter>
        </form>
      </Card>
      </div>
    </Layout>
  );
}
