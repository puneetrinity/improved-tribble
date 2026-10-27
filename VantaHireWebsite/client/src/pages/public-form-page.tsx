import { useState, useEffect, useRef } from "react";
import { FileDropzone } from "@/components/ui/file-dropzone";
import { useRoute } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertCircle, CheckCircle2, Clock, FileText, Loader2, Upload, X } from "lucide-react";
import Footer from "@/components/Footer";
import { useToast } from "@/hooks/use-toast";
import type { PublicFormDTO, FormAnswer, FormFieldSnapshot } from "@shared/forms.types";
import { formsApi, isFormsApiError, type FormsApiError } from "@/lib/formsApi";

type FormState = 'loading' | 'ready' | 'submitting' | 'success' | 'error' | 'expired' | 'already_submitted';

export default function PublicFormPage() {
  const [, params] = useRoute("/form/:token");
  const token = params?.token;
  const { toast } = useToast();

  const [state, setState] = useState<FormState>('loading');
  const [formData, setFormData] = useState<PublicFormDTO | null>(null);
  const [answers, setAnswers] = useState<Map<number, FormAnswer>>(new Map());
  const [errors, setErrors] = useState<Map<number, string>>(new Map());
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [uploadingFiles, setUploadingFiles] = useState<Set<number>>(new Set());
  // Chosen file per field, shown while it uploads (the uploaded view replaces it afterwards).
  const [pendingFiles, setPendingFiles] = useState<Map<number, File>>(new Map());
  // Per-field failed-upload message; the picker comes back so the user can retry at once.
  const [uploadErrors, setUploadErrors] = useState<Map<number, string>>(new Map());
  const forgetSelection = (fieldId: number) => {
    setPendingFiles((prev) => { const next = new Map(prev); next.delete(fieldId); return next; });
  };
  const setUploadError = (fieldId: number, message: string | null) => {
    setUploadErrors((prev) => { const next = new Map(prev); if (message) next.set(fieldId, message); else next.delete(fieldId); return next; });
  };

  // Fetch form data on mount - using typed API client with exhaustive error handling
  useEffect(() => {
    if (!token) {
      setState('error');
      setErrorMessage('Invalid form link');
      return;
    }

    formsApi.getPublicForm(token)
      .then((data) => {
        setFormData(data);
        setState('ready');
      })
      .catch((error: unknown) => {
        console.error('Error fetching form:', error);

        // Exhaustive error handling with discriminated union
        if (isFormsApiError(error)) {
          switch (error.type) {
            case 'expired':
              setState('expired');
              break;
            case 'already_submitted':
              setState('already_submitted');
              break;
            case 'invalid_token':
              setState('error');
              setErrorMessage('Invalid form link. Please check the URL.');
              break;
            case 'rate_limited':
              setState('error');
              setErrorMessage('Too many requests. Please try again in a few minutes.');
              break;
            case 'not_found':
              setState('error');
              setErrorMessage('Form not found. Please check the link.');
              break;
            case 'unauthorized':
            case 'validation_error':
            case 'server_error':
            case 'network_error':
              setState('error');
              setErrorMessage(error.message || 'Failed to load form. Please try again.');
              break;
          }
        } else {
          setState('error');
          setErrorMessage('Failed to load form. Please check the link and try again.');
        }
      });
  }, [token]);

  const handleInputChange = (fieldId: number, value: string) => {
    const newAnswers = new Map(answers);
    newAnswers.set(fieldId, { fieldId, value });
    setAnswers(newAnswers);

    // Clear error for this field
    const newErrors = new Map(errors);
    newErrors.delete(fieldId);
    setErrors(newErrors);
  };

  const handleFileUpload = async (fieldId: number, file: File) => {
    setUploadingFiles(new Set([...Array.from(uploadingFiles), fieldId]));

    try {
      // Use typed API client for file upload
      const { fileUrl, filename, size } = await formsApi.uploadPublicFile(token!, file);

      setAnswers((prev) => { const next = new Map(prev); next.set(fieldId, { fieldId, fileUrl, filename, size }); return next; });
      forgetSelection(fieldId);
      setUploadError(fieldId, null);

      // Clear error for this field
      const newErrors = new Map(errors);
      newErrors.delete(fieldId);
      setErrors(newErrors);

      toast({
        title: "File Uploaded",
        description: `${filename} (${(size / 1024).toFixed(1)} KB)`,
      });
    } catch (error: any) {
      console.error('File upload error:', error);
      // Never leave a failed local selection looking like an answer: restore the picker.
      forgetSelection(fieldId);
      setUploadError(fieldId, `Upload failed${error?.message ? `: ${error.message}` : ''}. Choose the file again to retry.`);
      toast({
        title: "Upload Failed",
        description: error.message || 'Failed to upload file',
        variant: "destructive",
      });
    } finally {
      setUploadingFiles((prev) => {
        const next = new Set(prev);
        next.delete(fieldId);
        return next;
      });
    }
  };

  const handleRemoveFile = (fieldId: number) => {
    const newAnswers = new Map(answers);
    newAnswers.delete(fieldId);
    setAnswers(newAnswers);
    forgetSelection(fieldId);
    setUploadError(fieldId, null);
  };

  const validateForm = (): boolean => {
    const newErrors = new Map<number, string>();
    let isValid = true;

    formData?.fields.forEach((field) => {
      const answer = answers.get(field.id);

      // Required field validation
      if (field.required) {
        if (field.type === 'file') {
          if (!answer || !answer.fileUrl) {
            newErrors.set(field.id, `${field.label} is required`);
            isValid = false;
            return;
          }
        } else {
          if (!answer || !answer.value?.trim()) {
            newErrors.set(field.id, `${field.label} is required`);
            isValid = false;
            return;
          }
        }
      }

      // Type-specific validation
      if (answer?.value) {
        switch (field.type) {
          case 'email':
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(answer.value)) {
              newErrors.set(field.id, 'Invalid email format');
              isValid = false;
            }
            break;
          case 'date':
            if (isNaN(Date.parse(answer.value))) {
              newErrors.set(field.id, 'Invalid date format');
              isValid = false;
            }
            break;
          case 'select':
            if (field.options) {
              const options = JSON.parse(field.options);
              if (!options.includes(answer.value)) {
                newErrors.set(field.id, 'Invalid option selected');
                isValid = false;
              }
            }
            break;
        }
      }
    });

    setErrors(newErrors);
    return isValid;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      toast({
        title: "Validation Error",
        description: "Please fix the errors in the form before submitting.",
        variant: "destructive",
      });
      return;
    }

    setState('submitting');

    try {
      const answersArray = Array.from(answers.values());

      // Use typed API client for submission
      await formsApi.submitPublicForm(token!, { answers: answersArray });

      setState('success');
      toast({
        title: "Success!",
        description: "Your response has been submitted successfully.",
      });
    } catch (error: unknown) {
      console.error('Error submitting form:', error);
      setState('ready');

      // Exhaustive error handling with discriminated union
      if (isFormsApiError(error)) {
        switch (error.type) {
          case 'already_submitted':
            toast({
              title: "Already Submitted",
              description: "You've already submitted this form. Thank you for your response!",
              variant: "destructive",
            });
            setState('already_submitted');
            break;
          case 'expired':
            toast({
              title: "Form Expired",
              description: "This form invitation has expired. Please contact the recruiter.",
              variant: "destructive",
            });
            setState('expired');
            break;
          case 'validation_error':
            toast({
              title: "Validation Error",
              description: error.message || "Please check your responses and try again.",
              variant: "destructive",
            });
            break;
          case 'rate_limited':
            toast({
              title: "Too Many Attempts",
              description: "Please wait a few minutes before trying again.",
              variant: "destructive",
            });
            break;
          default:
            toast({
              title: "Submission Failed",
              description: error.message || "Failed to submit form. Please try again.",
              variant: "destructive",
            });
        }
      } else {
        toast({
          title: "Submission Failed",
          description: "Failed to submit form. Please try again.",
          variant: "destructive",
        });
      }
    }
  };

  const renderField = (field: FormFieldSnapshot) => {
    const answer = answers.get(field.id);
    const error = errors.get(field.id);

    const commonProps = {
      id: `field-${field.id}`,
      required: field.required,
      className: error ? 'border-destructive' : '',
    };

    let inputElement;

    switch (field.type) {
      case 'short_text':
      case 'email':
        inputElement = (
          <Input
            {...commonProps}
            type={field.type === 'email' ? 'email' : 'text'}
            value={answer?.value || ''}
            onChange={(e) => handleInputChange(field.id, e.target.value)}
            placeholder={`Enter ${field.label.toLowerCase()}`}
          />
        );
        break;

      case 'long_text':
        inputElement = (
          <Textarea
            {...commonProps}
            value={answer?.value || ''}
            onChange={(e) => handleInputChange(field.id, e.target.value)}
            placeholder={`Enter ${field.label.toLowerCase()}`}
            rows={4}
          />
        );
        break;

      case 'yes_no':
        inputElement = (
          <Select
            value={answer?.value || ''}
            onValueChange={(value) => handleInputChange(field.id, value)}
          >
            <SelectTrigger {...commonProps}>
              <SelectValue placeholder="Select an option" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="yes">Yes</SelectItem>
              <SelectItem value="no">No</SelectItem>
            </SelectContent>
          </Select>
        );
        break;

      case 'select':
        const options = field.options ? JSON.parse(field.options) : [];
        inputElement = (
          <Select
            value={answer?.value || ''}
            onValueChange={(value) => handleInputChange(field.id, value)}
          >
            <SelectTrigger {...commonProps}>
              <SelectValue placeholder="Select an option" />
            </SelectTrigger>
            <SelectContent>
              {options.map((option: string) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
        break;

      case 'date':
        inputElement = (
          <Input
            {...commonProps}
            type="date"
            value={answer?.value || ''}
            onChange={(e) => handleInputChange(field.id, e.target.value)}
          />
        );
        break;

      case 'file':
        const isUploading = uploadingFiles.has(field.id);
        const fileAnswer = answer?.fileUrl;

        inputElement = (
          <div className="space-y-2">
            {!fileAnswer ? (
              <FileDropzone
                id={`field-${field.id}`}
                externalLabel
                label={field.label}
                required={field.required}
                accept=".pdf,.doc,.docx"
                maxSizeMB={5}
                value={pendingFiles.get(field.id) ?? null}
                busy={isUploading}
                error={uploadErrors.get(field.id) ?? null}
                onChange={(file) => {
                  setUploadError(field.id, null);
                  if (!file) { forgetSelection(field.id); return; }
                  setPendingFiles((prev) => new Map(prev).set(field.id, file));
                  handleFileUpload(field.id, file);
                }}
              />
            ) : (
              <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg border border-border">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <Upload className="w-4 h-4 text-success flex-shrink-0" />
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm text-foreground truncate">
                      {answer.filename || 'File uploaded'}
                    </span>
                    {answer.size && (
                      <span className="text-xs text-muted-foreground">
                        {(answer.size / 1024).toFixed(1)} KB
                      </span>
                    )}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRemoveFile(field.id)}
                  className="text-destructive hover:text-destructive hover:bg-destructive/10 flex-shrink-0"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            )}
          </div>
        );
        break;

      default:
        inputElement = (
          <Input
            {...commonProps}
            type="text"
            value={answer?.value || ''}
            onChange={(e) => handleInputChange(field.id, e.target.value)}
          />
        );
    }

    return (
      <div key={field.id} className="space-y-2">
        <Label htmlFor={`field-${field.id}`} className="text-foreground">
          {field.label}
          {field.required && <span className="text-destructive ml-1">*</span>}
        </Label>
        {inputElement}
        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}
      </div>
    );
  };

  // Loading state
  if (state === 'loading') {
    return (
      <div className="min-h-screen w-full flex flex-col public-theme bg-background text-foreground">
        <div className="flex-1 flex items-center justify-center">
          <Card className="w-full max-w-2xl mx-4 bg-muted/50 backdrop-blur-sm border-border">
            <CardContent className="pt-6 flex items-center justify-center">
              <Loader2 className="h-8 w-8 text-foreground animate-spin" />
              <span className="ml-2 text-foreground">Loading form...</span>
            </CardContent>
          </Card>
        </div>
        <Footer />
      </div>
    );
  }

  // Expired state
  if (state === 'expired') {
    return (
      <div className="min-h-screen w-full flex flex-col public-theme bg-background text-foreground">
        <div className="flex-1 flex items-center justify-center">
          <Card className="w-full max-w-2xl mx-4 bg-muted/50 backdrop-blur-sm border-border">
            <CardContent className="pt-6">
              <div className="flex mb-4 gap-2">
                <Clock className="h-8 w-8 text-warning" />
                <h1 className="text-2xl font-bold text-foreground">Form Expired</h1>
              </div>
              <p className="mt-4 text-sm text-muted-foreground">
                This form invitation has expired. Please contact the recruiter for a new link.
              </p>
            </CardContent>
          </Card>
        </div>
        <Footer />
      </div>
    );
  }

  // Already submitted state
  if (state === 'already_submitted') {
    return (
      <div className="min-h-screen w-full flex flex-col public-theme bg-background text-foreground">
        <div className="flex-1 flex items-center justify-center">
          <Card className="w-full max-w-2xl mx-4 bg-muted/50 backdrop-blur-sm border-border">
            <CardContent className="pt-6">
              <div className="flex mb-4 gap-2">
                <CheckCircle2 className="h-8 w-8 text-success" />
                <h1 className="text-2xl font-bold text-foreground">Already Submitted</h1>
              </div>
              <p className="mt-4 text-sm text-muted-foreground">
                You've already submitted this form. Thank you for your response!
              </p>
            </CardContent>
          </Card>
        </div>
        <Footer />
      </div>
    );
  }

  // Error state
  if (state === 'error') {
    return (
      <div className="min-h-screen w-full flex flex-col public-theme bg-background text-foreground">
        <div className="flex-1 flex items-center justify-center">
          <Card className="w-full max-w-2xl mx-4 bg-muted/50 backdrop-blur-sm border-border">
            <CardContent className="pt-6">
              <div className="flex mb-4 gap-2">
                <AlertCircle className="h-8 w-8 text-destructive" />
                <h1 className="text-2xl font-bold text-foreground">Error</h1>
              </div>
              <p className="mt-4 text-sm text-muted-foreground">
                {errorMessage || 'Failed to load form. Please check the link and try again.'}
              </p>
            </CardContent>
          </Card>
        </div>
        <Footer />
      </div>
    );
  }

  // Success state
  if (state === 'success') {
    return (
      <div className="min-h-screen w-full flex flex-col public-theme bg-background text-foreground">
        <div className="flex-1 flex items-center justify-center">
          <Card className="w-full max-w-2xl mx-4 bg-muted/50 backdrop-blur-sm border-border">
            <CardContent className="pt-6">
              <div className="flex mb-4 gap-2">
                <CheckCircle2 className="h-8 w-8 text-success" />
                <h1 className="text-2xl font-bold text-foreground">Success!</h1>
              </div>
              <p className="mt-4 text-sm text-muted-foreground">
                Thank you! Your response has been submitted successfully. You may close this page.
              </p>
            </CardContent>
          </Card>
        </div>
        <Footer />
      </div>
    );
  }

  // Form ready state
  return (
    <div className="min-h-screen w-full flex flex-col public-theme bg-background text-foreground">
      <div className="flex-1 flex items-center justify-center py-8">
        <Card className="w-full max-w-2xl mx-4 bg-muted/50 backdrop-blur-sm border-border">
          <CardHeader>
            <div className="flex items-center gap-2 mb-2">
              <FileText className="h-6 w-6 text-primary" />
              <CardTitle className="text-2xl text-foreground">{formData?.formName}</CardTitle>
            </div>
            {formData?.formDescription && (
              <CardDescription className="text-muted-foreground">
                {formData.formDescription}
              </CardDescription>
            )}
            <p className="text-xs text-muted-foreground mt-2">
              Expires: {new Date(formData?.expiresAt || '').toLocaleDateString()}
            </p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              {formData?.fields.map((field) => renderField(field))}

              <div className="flex justify-end pt-4">
                <Button
                  type="submit"
                  disabled={state === 'submitting'}
                  className="bg-primary hover:bg-primary/80 text-foreground"
                >
                  {state === 'submitting' ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    'Submit Form'
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
      <Footer />
    </div>
  );
}
