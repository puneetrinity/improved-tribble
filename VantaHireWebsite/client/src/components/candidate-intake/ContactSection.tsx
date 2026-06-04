import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChevronRight, AlertCircle } from "lucide-react";
import { contactSchema, type ContactData } from "./types";

interface ContactSectionProps {
  data: ContactData;
  onChange: (data: ContactData) => void;
  onValidChange: (isValid: boolean) => void;
  onContinue: () => void;
}

export function ContactSection({
  data,
  onChange,
  onValidChange,
  onContinue,
}: ContactSectionProps) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  // Validate on data change
  useEffect(() => {
    const result = contactSchema.safeParse(data);
    onValidChange(result.success);

    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      result.error.errors.forEach((err) => {
        const field = err.path[0] as string;
        fieldErrors[field] = err.message;
      });
      setErrors(fieldErrors);
    } else {
      setErrors({});
    }
  }, [data, onValidChange]);

  const updateField = (field: keyof ContactData, value: string) => {
    onChange({ ...data, [field]: value });
  };

  const handleBlur = (field: string) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
  };

  const showError = (field: string) => touched[field] && errors[field];

  const handleContinue = () => {
    // Mark all fields as touched to show errors
    setTouched({
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      location: true,
    });

    const result = contactSchema.safeParse(data);
    if (result.success) {
      onContinue();
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-foreground">Contact Information</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Basic contact details for the candidate
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="firstName">
            First Name <span className="text-destructive">*</span>
          </Label>
          <Input
            id="firstName"
            value={data.firstName}
            onChange={(e) => updateField("firstName", e.target.value)}
            onBlur={() => handleBlur("firstName")}
            placeholder="Jane"
            className={showError("firstName") ? "border-destructive" : ""}
          />
          {showError("firstName") && (
            <p className="text-xs text-destructive flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />
              {errors.firstName}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="lastName">
            Last Name <span className="text-destructive">*</span>
          </Label>
          <Input
            id="lastName"
            value={data.lastName}
            onChange={(e) => updateField("lastName", e.target.value)}
            onBlur={() => handleBlur("lastName")}
            placeholder="Doe"
            className={showError("lastName") ? "border-destructive" : ""}
          />
          {showError("lastName") && (
            <p className="text-xs text-destructive flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />
              {errors.lastName}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">
          Email <span className="text-destructive">*</span>
        </Label>
        <Input
          id="email"
          type="email"
          value={data.email}
          onChange={(e) => updateField("email", e.target.value)}
          onBlur={() => handleBlur("email")}
          placeholder="jane.doe@example.com"
          className={showError("email") ? "border-destructive" : ""}
        />
        {showError("email") && (
          <p className="text-xs text-destructive flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
            {errors.email}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="phone">
            Phone <span className="text-destructive">*</span>
          </Label>
          <Input
            id="phone"
            type="tel"
            inputMode="numeric"
            pattern="\d*"
            maxLength={10}
            value={data.phone}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, "").slice(0, 10);
              updateField("phone", digits);
            }}
            onBlur={() => handleBlur("phone")}
            placeholder="10-digit number"
            className={showError("phone") ? "border-destructive" : ""}
          />
          {showError("phone") && (
            <p className="text-xs text-destructive flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />
              {errors.phone}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="location">Location</Label>
          <Input
            id="location"
            value={data.location}
            onChange={(e) => updateField("location", e.target.value)}
            placeholder="San Francisco, CA"
          />
        </div>
      </div>

      <div className="pt-4 flex justify-end">
        <Button onClick={handleContinue}>
          Continue
          <ChevronRight className="h-4 w-4 ml-2" />
        </Button>
      </div>
    </div>
  );
}
