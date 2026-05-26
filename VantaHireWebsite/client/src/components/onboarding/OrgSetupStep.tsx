import { useState } from "react";
import { useCreateOrganization } from "@/hooks/use-organization";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/queryClient";
import { Building2, Globe, Loader2, Info } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

// Public email domains that cannot be used for auto-join
const PUBLIC_DOMAINS = [
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com',
  'aol.com', 'icloud.com', 'mail.com', 'protonmail.com', 'zoho.com',
  'yandex.com', 'gmx.com', 'fastmail.com', 'tutanota.com', 'pm.me'
];

interface OrgSetupStepProps {
  onComplete: () => void;
  userEmail: string;
}

export default function OrgSetupStep({ onComplete, userEmail }: OrgSetupStepProps) {
  const { toast } = useToast();
  const createOrg = useCreateOrganization();

  const [orgName, setOrgName] = useState("");
  const [showDomainSection, setShowDomainSection] = useState(false);
  const [requestDomain, setRequestDomain] = useState(false);
  const [domain, setDomain] = useState("");

  // Extract domain from user's email
  const userEmailDomain = userEmail?.split('@')[1]?.toLowerCase() || '';
  const isPublicEmailUser = PUBLIC_DOMAINS.includes(userEmailDomain);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!orgName.trim()) {
      toast({
        title: "Error",
        description: "Please enter an organization name",
        variant: "destructive",
      });
      return;
    }

    try {
      await createOrg.mutateAsync({ name: orgName.trim() });

      // If user wants domain verification, submit that request too
      if (requestDomain && domain.trim()) {
        const normalizedDomain = domain.trim().toLowerCase();
        const domainRegex = /^[a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,}$/;

        if (domainRegex.test(normalizedDomain) && !PUBLIC_DOMAINS.includes(normalizedDomain)) {
          try {
            await apiRequest('POST', '/api/organizations/domain/request', { domain: normalizedDomain });

            toast({
              title: "Organization created",
              description: "Your domain verification request has been submitted.",
            });
          } catch {
            // Don't fail org creation if domain request fails
            toast({
              title: "Organization created",
              description: "Domain request failed, but you can try again later from settings.",
            });
          }
        }
      } else {
        toast({
          title: "Organization created",
          description: "Your organization has been set up successfully.",
        });
      }

      onComplete();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to create organization",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 mb-4">
          <Building2 className="h-6 w-6 text-primary" />
        </div>
        <h2 className="text-xl font-semibold text-foreground">
          Create Your Organization
        </h2>
        <p className="text-muted-foreground mt-1">
          Set up your company or team on ealana
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="orgName">Organization Name *</Label>
          <Input
            id="orgName"
            placeholder="Acme Inc."
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            className="text-lg"
            autoFocus
          />
          <p className="text-xs text-muted-foreground">
            This will be visible on your job postings
          </p>
        </div>

        {/* Optional Domain Verification */}
        <Collapsible open={showDomainSection} onOpenChange={setShowDomainSection}>
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              className="w-full justify-between text-muted-foreground hover:text-foreground"
            >
              <span className="flex items-center gap-2">
                <Globe className="h-4 w-4" />
                Domain verification (optional)
              </span>
              <span className="text-xs">{showDomainSection ? 'Hide' : 'Show'}</span>
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-4 pt-4">
            <div className="p-4 bg-muted/50 rounded-lg border border-border">
              <div className="flex items-start gap-3">
                <Info className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium text-foreground">
                    Why verify your domain?
                  </p>
                  <p className="text-muted-foreground mt-1">
                    Team members with @{isPublicEmailUser ? 'yourcompany.com' : userEmailDomain} emails
                    can easily find and request to join your organization.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="requestDomain"
                checked={requestDomain}
                onChange={(e) => setRequestDomain(e.target.checked)}
                className="rounded border-border"
              />
              <Label htmlFor="requestDomain" className="cursor-pointer">
                Request domain verification
              </Label>
            </div>

            {requestDomain && (
              <div className="space-y-2">
                <Label htmlFor="domain">Company Domain</Label>
                <div className="flex items-center gap-1">
                  <span className="text-muted-foreground">@</span>
                  <Input
                    id="domain"
                    placeholder="company.com"
                    value={domain}
                    onChange={(e) => setDomain(e.target.value.toLowerCase())}
                    className="flex-1"
                  />
                </div>
                {!isPublicEmailUser && userEmailDomain && (
                  <p className="text-sm text-muted-foreground">
                    Suggested: <strong>@{userEmailDomain}</strong>
                    <Button
                      type="button"
                      variant="link"
                      className="h-auto p-0 ml-2 text-primary"
                      onClick={() => setDomain(userEmailDomain)}
                    >
                      Use this
                    </Button>
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Your request will be reviewed by ealana admins.
                  You can skip this and set it up later from organization settings.
                </p>
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>

        <div className="flex justify-end pt-4">
          <Button
            type="submit"
            disabled={createOrg.isPending || !orgName.trim()}
            className="min-w-32"
          >
            {createOrg.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              'Continue'
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
