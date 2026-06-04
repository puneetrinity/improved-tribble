import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { User, Building, MapPin, Linkedin, Phone, Loader2 } from "lucide-react";

interface UserProfile {
  displayName: string | null;
  company: string | null;
  phone: string | null;
  bio: string | null;
  linkedin: string | null;
  location: string | null;
}

interface ProfileData {
  user: {
    id: number;
    username: string;
    firstName: string | null;
    lastName: string | null;
    role: string;
  };
  profile: UserProfile;
}

interface ProfileStepProps {
  onComplete: () => void;
}

interface OrgData {
  organization: {
    id: number;
    name: string;
  };
  membership: {
    role: string;
  };
}

export default function ProfileStep({ onComplete }: ProfileStepProps) {
  const { user } = useAuth();
  const { toast } = useToast();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [company, setCompany] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const [location, setLocation] = useState("");
  const [bio, setBio] = useState("");

  // Fetch current profile
  const { data: profileData, isLoading } = useQuery<ProfileData>({
    queryKey: ["/api/profile"],
    queryFn: async () => {
      const response = await fetch("/api/profile", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch profile");
      return response.json();
    },
    enabled: !!user,
  });

  // Fetch organization data to prefill company when profile company is missing.
  const { data: orgData } = useQuery<OrgData>({
    queryKey: ["/api/organizations/current"],
    queryFn: async () => {
      const response = await fetch("/api/organizations/current", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch organization");
      return response.json();
    },
    enabled: !!user,
  });

  // Initialize form with existing data
  useEffect(() => {
    if (profileData) {
      setFirstName(profileData.user.firstName || "");
      setLastName(profileData.user.lastName || "");
      // If company is not set, use org name.
      const existingCompany = profileData.profile.company || "";
      if (!existingCompany && orgData?.organization?.name) {
        setCompany(orgData.organization.name);
      } else {
        setCompany(existingCompany);
      }
      setDisplayName(profileData.profile.displayName || "");
      setPhone(profileData.profile.phone || "");
      setLinkedin(profileData.profile.linkedin || "");
      setLocation(profileData.profile.location || "");
      setBio(profileData.profile.bio || "");
    }
  }, [profileData, orgData]);

  // Update user (for first/last name)
  const updateUserMutation = useMutation({
    mutationFn: async (data: { firstName: string; lastName: string }) => {
      const res = await apiRequest("PATCH", "/api/user", data);
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to update user");
      }
      return res.json();
    },
  });

  // Update profile
  const updateProfileMutation = useMutation({
    mutationFn: async (updates: Partial<UserProfile>) => {
      const res = await apiRequest("PATCH", "/api/profile", updates);
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to update profile");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/profile"] });
      queryClient.invalidateQueries({ queryKey: ["/api/profile-status"] });
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate required fields
    if (!firstName.trim() || !lastName.trim() || !company.trim() || !phone.trim()) {
      toast({
        title: "Missing required fields",
        description: "Please fill in your first name, last name, company, and phone number.",
        variant: "destructive",
      });
      return;
    }

    try {
      // Update user first/last name if changed
      if (firstName !== profileData?.user.firstName || lastName !== profileData?.user.lastName) {
        await updateUserMutation.mutateAsync({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
        });
      }

      // Update profile
      await updateProfileMutation.mutateAsync({
        company: company.trim(),
        displayName: displayName.trim() || null,
        phone: phone.trim() || null,
        linkedin: linkedin.trim() || null,
        location: location.trim() || null,
        bio: bio.trim() || null,
      });

      toast({
        title: "Profile updated",
        description: "Your profile has been saved successfully.",
      });

      onComplete();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const isSubmitting = updateUserMutation.isPending || updateProfileMutation.isPending;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 mb-4">
          <User className="h-6 w-6 text-primary" />
        </div>
        <h2 className="text-xl font-semibold text-foreground">
          Complete Your Profile
        </h2>
        <p className="text-muted-foreground mt-1">
          Help candidates learn more about you
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Required Section */}
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Required
          </h3>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="firstName">First Name *</Label>
              <Input
                id="firstName"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="John"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName">Last Name *</Label>
              <Input
                id="lastName"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Doe"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="company" className="flex items-center gap-2">
                <Building className="h-4 w-4" />
                Company *
              </Label>
              <Input
                id="company"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="Acme Inc."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone" className="flex items-center gap-2">
                <Phone className="h-4 w-4" />
                Phone *
              </Label>
              <Input
                id="phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91 98765 43210"
              />
            </div>
          </div>
        </div>

        {/* Optional Section */}
        <div className="space-y-4 pt-4 border-t border-border">
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Optional
          </h3>

          <div className="space-y-2">
            <Label htmlFor="displayName">Display Name</Label>
            <Input
              id="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="How you want to appear on job postings"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="location" className="flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              Location
            </Label>
            <Input
              id="location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="City, Country"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="linkedin" className="flex items-center gap-2">
              <Linkedin className="h-4 w-4" />
              LinkedIn Profile
            </Label>
            <Input
              id="linkedin"
              type="url"
              value={linkedin}
              onChange={(e) => setLinkedin(e.target.value)}
              placeholder="https://linkedin.com/in/your-profile"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="bio">Bio</Label>
            <Textarea
              id="bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Tell candidates about yourself and your recruiting experience..."
              rows={3}
              maxLength={2000}
            />
            <p className="text-xs text-muted-foreground text-right">
              {bio.length}/2000
            </p>
          </div>
        </div>

        <div className="flex justify-end pt-4">
          <Button
            type="submit"
            disabled={isSubmitting || !firstName.trim() || !lastName.trim() || !company.trim() || !phone.trim()}
            className="min-w-32"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
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
