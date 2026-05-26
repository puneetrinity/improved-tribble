import { useEffect, useState } from "react";
import {
  useOrganization,
  useUpdateOrganization,
} from "@/hooks/use-organization";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Building2,
  Globe,
  FileText,
  Loader2,
  CheckCircle,
  AlertCircle,
  Copy,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { orgSettingsPageCopy } from "@/lib/internal-copy";
import BrandedLoadingScreen from "@/components/internal/BrandedLoadingScreen";

export default function OrgSettingsPage() {
  const { data: orgData, isLoading } = useOrganization();
  const updateOrg = useUpdateOrganization();
  const { toast } = useToast();

  const [name, setName] = useState("");
  const [billingName, setBillingName] = useState("");
  const [billingAddress, setBillingAddress] = useState("");
  const [billingCity, setBillingCity] = useState("");
  const [billingState, setBillingState] = useState("");
  const [billingPincode, setBillingPincode] = useState("");
  const [billingContactEmail, setBillingContactEmail] = useState("");
  const [billingContactName, setBillingContactName] = useState("");
  const [gstin, setGstin] = useState("");
  const [isGeneralDirty, setIsGeneralDirty] = useState(false);
  const [isBillingDirty, setIsBillingDirty] = useState(false);

  const isOwner = orgData?.membership?.role === 'owner';
  const isAdmin = orgData?.membership?.role === 'admin' || isOwner;

  // Keep forms in sync with server data until the user starts editing.
  useEffect(() => {
    if (orgData?.organization) {
      const org = orgData.organization;
      if (!isGeneralDirty) {
        setName(org.name || "");
      }
      if (!isBillingDirty) {
        setBillingName(org.billingName || "");
        setBillingAddress(org.billingAddress || "");
        setBillingCity(org.billingCity || "");
        setBillingState(org.billingState || "");
        setBillingPincode(org.billingPincode || "");
        setBillingContactEmail(org.billingContactEmail || "");
        setBillingContactName(org.billingContactName || "");
        setGstin(org.gstin || "");
      }
    }
  }, [orgData, isBillingDirty, isGeneralDirty]);

  const handleSaveGeneral = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    try {
      await updateOrg.mutateAsync({ name: name.trim() });
      toast({
        title: orgSettingsPageCopy.toasts.settingsSavedTitle,
        description: orgSettingsPageCopy.toasts.settingsSavedDescription,
      });
      setIsGeneralDirty(false);
    } catch (error: any) {
      toast({
        title: orgSettingsPageCopy.toasts.errorTitle,
        description: error.message || orgSettingsPageCopy.toasts.updateSettingsError,
        variant: "destructive",
      });
    }
  };

  const handleSaveBilling = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      await updateOrg.mutateAsync({
        billingName: billingName.trim() || null,
        billingAddress: billingAddress.trim() || null,
        billingCity: billingCity.trim() || null,
        billingState: billingState.trim() || null,
        billingPincode: billingPincode.trim() || null,
        billingContactEmail: billingContactEmail.trim() || null,
        billingContactName: billingContactName.trim() || null,
        gstin: gstin.trim() || null,
      });
      toast({
        title: orgSettingsPageCopy.toasts.billingSavedTitle,
        description: orgSettingsPageCopy.toasts.billingSavedDescription,
      });
      setIsBillingDirty(false);
    } catch (error: any) {
      toast({
        title: orgSettingsPageCopy.toasts.errorTitle,
        description: error.message || orgSettingsPageCopy.toasts.updateBillingError,
        variant: "destructive",
      });
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({
        title: orgSettingsPageCopy.toasts.copiedTitle,
        description: orgSettingsPageCopy.toasts.copiedDescription,
      });
    } catch {
      toast({
        title: orgSettingsPageCopy.toasts.errorTitle,
        description: "Failed to copy to clipboard.",
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="mx-auto max-w-7xl p-6">
          <BrandedLoadingScreen label="Loading organization settings..." />
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
                {orgSettingsPageCopy.header.noOrganization}
              </p>
            </CardContent>
          </Card>
        </div>
      </Layout>
    );
  }

  const org = orgData.organization;

  return (
    <Layout>
      <div className="max-w-7xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{orgSettingsPageCopy.header.title}</h1>
        <p className="text-muted-foreground">
          {orgSettingsPageCopy.header.subtitle}
        </p>
      </div>

      {/* General Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            {orgSettingsPageCopy.general.title}
          </CardTitle>
          <CardDescription>
            {orgSettingsPageCopy.general.description}
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSaveGeneral}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">{orgSettingsPageCopy.general.organizationName}</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setIsGeneralDirty(true);
                }}
                disabled={!isOwner}
                placeholder={orgSettingsPageCopy.general.organizationNamePlaceholder}
              />
              {!isOwner && (
                <p className="text-xs text-muted-foreground">
                  {orgSettingsPageCopy.general.ownerOnlyHint}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>{orgSettingsPageCopy.general.organizationSlug}</Label>
              <div className="flex items-center gap-2">
                <code className="flex-1 p-2 bg-slate-100 rounded text-sm">
                  {org.slug}
                </code>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Copy organization slug"
                  onClick={() => copyToClipboard(org.slug)}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {orgSettingsPageCopy.general.slugHint}
              </p>
            </div>
          </CardContent>
          {isOwner && (
            <CardFooter className="border-t pt-6">
              <Button type="submit" disabled={updateOrg.isPending || !name.trim()}>
                {updateOrg.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {orgSettingsPageCopy.general.save}
              </Button>
            </CardFooter>
          )}
        </form>
      </Card>

      {/* Domain Verification */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            {orgSettingsPageCopy.domain.title}
          </CardTitle>
          <CardDescription>
            {orgSettingsPageCopy.domain.description}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {org.domain ? (
            <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
              <div className="flex items-center gap-3">
                {org.domainVerified ? (
                  <CheckCircle className="h-5 w-5 text-green-500" />
                ) : (
                  <AlertCircle className="h-5 w-5 text-amber-500" />
                )}
                <div>
                  <p className="font-medium">@{org.domain}</p>
                  <p className="text-sm text-muted-foreground">
                    {org.domainVerified
                      ? orgSettingsPageCopy.domain.verifiedDescription
                      : orgSettingsPageCopy.domain.pendingDescription
                    }
                  </p>
                </div>
              </div>
              <Badge variant={org.domainVerified ? "default" : "secondary"}>
                {org.domainVerified ? orgSettingsPageCopy.domain.verifiedBadge : orgSettingsPageCopy.domain.pendingBadge}
              </Badge>
            </div>
          ) : (
            <div className="text-center py-6">
              <Globe className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
              <p className="text-muted-foreground mb-4">
                {orgSettingsPageCopy.domain.emptyState}
              </p>
              {isOwner && (
                <Button variant="outline" asChild>
                  <a href="/org/domain">{orgSettingsPageCopy.domain.requestVerification}</a>
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Billing Information */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {orgSettingsPageCopy.billing.title}
          </CardTitle>
          <CardDescription>
            {orgSettingsPageCopy.billing.description}
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSaveBilling}>
          <CardContent className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="billingContactName">{orgSettingsPageCopy.billing.billingContactName}</Label>
                <Input
                  id="billingContactName"
                  value={billingContactName}
                  onChange={(e) => {
                    setBillingContactName(e.target.value);
                    setIsBillingDirty(true);
                  }}
                  disabled={!isAdmin}
                  placeholder={orgSettingsPageCopy.billing.billingContactNamePlaceholder}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="billingContactEmail">{orgSettingsPageCopy.billing.billingContactEmail}</Label>
                <Input
                  id="billingContactEmail"
                  type="email"
                  value={billingContactEmail}
                  onChange={(e) => {
                    setBillingContactEmail(e.target.value);
                    setIsBillingDirty(true);
                  }}
                  disabled={!isAdmin}
                  placeholder={orgSettingsPageCopy.billing.billingContactEmailPlaceholder}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="billingName">{orgSettingsPageCopy.billing.legalName}</Label>
              <Input
                id="billingName"
                value={billingName}
                onChange={(e) => {
                  setBillingName(e.target.value);
                  setIsBillingDirty(true);
                }}
                disabled={!isAdmin}
                placeholder={orgSettingsPageCopy.billing.legalNamePlaceholder}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="gstin">{orgSettingsPageCopy.billing.gstin}</Label>
              <Input
                id="gstin"
                value={gstin}
                onChange={(e) => {
                  setGstin(e.target.value.toUpperCase());
                  setIsBillingDirty(true);
                }}
                disabled={!isAdmin}
                placeholder={orgSettingsPageCopy.billing.gstinPlaceholder}
                maxLength={15}
              />
              <p className="text-xs text-muted-foreground">
                {orgSettingsPageCopy.billing.gstinHint}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="billingAddress">Billing Address</Label>
              <Textarea
                id="billingAddress"
                value={billingAddress}
                onChange={(e) => {
                  setBillingAddress(e.target.value);
                  setIsBillingDirty(true);
                }}
                disabled={!isAdmin}
                placeholder="123 Business Street, Suite 100"
                rows={2}
              />
            </div>

            <div className="grid md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="billingCity">City</Label>
                <Input
                  id="billingCity"
                  value={billingCity}
                  onChange={(e) => {
                    setBillingCity(e.target.value);
                    setIsBillingDirty(true);
                  }}
                  disabled={!isAdmin}
                  placeholder="Mumbai"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="billingState">State</Label>
                <Input
                  id="billingState"
                  value={billingState}
                  onChange={(e) => {
                    setBillingState(e.target.value);
                    setIsBillingDirty(true);
                  }}
                  disabled={!isAdmin}
                  placeholder="Maharashtra"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="billingPincode">Pincode</Label>
                <Input
                  id="billingPincode"
                  value={billingPincode}
                  onChange={(e) => {
                    setBillingPincode(e.target.value);
                    setIsBillingDirty(true);
                  }}
                  disabled={!isAdmin}
                  placeholder="400001"
                  maxLength={6}
                />
              </div>
            </div>
          </CardContent>
          {isAdmin && (
            <CardFooter className="border-t pt-6">
              <Button type="submit" disabled={updateOrg.isPending}>
                {updateOrg.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save Billing Info
              </Button>
            </CardFooter>
          )}
        </form>
      </Card>
      </div>
    </Layout>
  );
}
