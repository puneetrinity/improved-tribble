/**
 * UI Gallery - Development-only page for previewing all design system components
 *
 * Access: /dev/ui-gallery (only available in development mode)
 *
 * This page renders all core components with various states/variants
 * to help maintain visual consistency and catch regressions.
 */

import { useState } from "react";
import { PageShell, PageHeader, Container, Section } from "@/components/layout/index";
import { InternalHero } from "@/components/internal/InternalHero";
import { InternalEmptyState } from "@/components/internal/InternalEmptyState";
import { JobSubNav } from "@/components/JobSubNav";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  Shield,
  Users,
  Briefcase,
  Settings,
  AlertCircle,
  CheckCircle,
  Info,
  AlertTriangle,
  Plus,
  Download,
  Trash2
} from "lucide-react";

export default function DevUIGallery() {
  const [inputValue, setInputValue] = useState("");

  return (
    <PageShell variant="app">
      <PageHeader
        icon={Settings}
        title="UI Gallery"
        description="Design system component preview (development only)"
        breadcrumbs={[
          { label: "Dev", href: "/" },
          { label: "UI Gallery" }
        ]}
      />

      {/* Color Tokens */}
      <Section>
        <h2 className="text-xl font-semibold text-foreground mb-4">Color Tokens</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <ColorSwatch name="background" className="bg-background border" />
          <ColorSwatch name="foreground" className="bg-foreground" textLight />
          <ColorSwatch name="card" className="bg-card border" />
          <ColorSwatch name="muted" className="bg-muted" />
          <ColorSwatch name="primary" className="bg-primary" textLight />
          <ColorSwatch name="secondary" className="bg-secondary" />
          <ColorSwatch name="accent" className="bg-accent" />
          <ColorSwatch name="destructive" className="bg-destructive" textLight />
          <ColorSwatch name="success" className="bg-success" textLight />
          <ColorSwatch name="warning" className="bg-warning" textLight />
          <ColorSwatch name="info" className="bg-info" textLight />
          <ColorSwatch name="border" className="bg-border" />
        </div>
      </Section>

      <Separator className="my-8" />

      {/* Typography */}
      <Section>
        <h2 className="text-xl font-semibold text-foreground mb-4">Typography</h2>
        <div className="space-y-3">
          <p className="text-foreground">text-foreground: Primary text color</p>
          <p className="text-muted-foreground">text-muted-foreground: Secondary/muted text</p>
          <p className="text-primary">text-primary: Brand primary color</p>
          <p className="text-destructive">text-destructive: Error/destructive text</p>
          <p className="text-success-foreground bg-success/10 px-2 py-1 rounded inline-block">text-success-foreground: Success text</p>
          <p className="text-warning-foreground bg-warning/10 px-2 py-1 rounded inline-block">text-warning-foreground: Warning text</p>
          <p className="text-info-foreground bg-info/10 px-2 py-1 rounded inline-block">text-info-foreground: Info text</p>
        </div>
      </Section>

      <Separator className="my-8" />

      {/* Buttons */}
      <Section>
        <h2 className="text-xl font-semibold text-foreground mb-4">Buttons</h2>
        <div className="flex flex-wrap gap-3">
          <Button>Default</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="link">Link</Button>
          <Button variant="gold">Gold (Brand)</Button>
        </div>
        <div className="flex flex-wrap gap-3 mt-4">
          <Button size="sm"><Plus className="h-4 w-4 mr-1" />Small</Button>
          <Button><Download className="h-4 w-4 mr-2" />Default</Button>
          <Button size="lg"><Trash2 className="h-4 w-4 mr-2" />Large</Button>
        </div>
        <div className="flex flex-wrap gap-3 mt-4">
          <Button disabled>Disabled</Button>
          <Button variant="outline" disabled>Disabled Outline</Button>
        </div>
      </Section>

      <Separator className="my-8" />

      {/* Badges */}
      <Section>
        <h2 className="text-xl font-semibold text-foreground mb-4">Badges</h2>
        <div className="flex flex-wrap gap-3">
          <Badge>Default</Badge>
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="outline">Outline</Badge>
          <Badge variant="destructive">Destructive</Badge>
        </div>
        <div className="flex flex-wrap gap-3 mt-4">
          <Badge className="bg-success/10 text-success-foreground border-success/20">Success</Badge>
          <Badge className="bg-warning/10 text-warning-foreground border-warning/20">Warning</Badge>
          <Badge className="bg-info/10 text-info-foreground border-info/20">Info</Badge>
          <Badge className="bg-destructive/10 text-destructive border-destructive/20">Error</Badge>
        </div>
      </Section>

      <Separator className="my-8" />

      {/* Cards */}
      <Section>
        <h2 className="text-xl font-semibold text-foreground mb-4">Cards</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Default Card</CardTitle>
              <CardDescription>This is a basic card with header and content</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">Card content goes here using semantic text colors.</p>
            </CardContent>
            <CardFooter>
              <Button size="sm">Action</Button>
            </CardFooter>
          </Card>

          <Card className="border-success/20 bg-success/5">
            <CardHeader className="flex flex-row items-center gap-3">
              <CheckCircle className="h-5 w-5 text-success" />
              <div>
                <CardTitle>Success Card</CardTitle>
                <CardDescription>Operation completed</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">Success state styling example.</p>
            </CardContent>
          </Card>

          <Card className="border-warning/20 bg-warning/5">
            <CardHeader className="flex flex-row items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-warning" />
              <div>
                <CardTitle>Warning Card</CardTitle>
                <CardDescription>Action required</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">Warning state styling example.</p>
            </CardContent>
          </Card>
        </div>
      </Section>

      <Separator className="my-8" />

      {/* Alerts */}
      <Section>
        <h2 className="text-xl font-semibold text-foreground mb-4">Alerts</h2>
        <div className="space-y-4">
          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>Default Alert</AlertTitle>
            <AlertDescription>This is a default alert using semantic tokens.</AlertDescription>
          </Alert>

          <Alert className="border-success/20 bg-success/5 text-success-foreground">
            <CheckCircle className="h-4 w-4" />
            <AlertTitle>Success</AlertTitle>
            <AlertDescription className="text-muted-foreground">Your changes have been saved successfully.</AlertDescription>
          </Alert>

          <Alert className="border-warning/20 bg-warning/5 text-warning-foreground">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Warning</AlertTitle>
            <AlertDescription className="text-muted-foreground">Please review before proceeding.</AlertDescription>
          </Alert>

          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>Something went wrong. Please try again.</AlertDescription>
          </Alert>
        </div>
      </Section>

      <Separator className="my-8" />

      {/* Form Elements */}
      <Section>
        <h2 className="text-xl font-semibold text-foreground mb-4">Form Elements</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label htmlFor="example">Default Input</Label>
            <Input
              id="example"
              placeholder="Enter text..."
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="disabled">Disabled Input</Label>
            <Input id="disabled" placeholder="Disabled..." disabled />
          </div>
        </div>
      </Section>

      <Separator className="my-8" />

      {/* Layout Components */}
      <Section>
        <h2 className="text-xl font-semibold text-foreground mb-4">PageHeader Examples</h2>
        <div className="space-y-6 border rounded-lg p-4 bg-muted/30">
          <PageHeader
            icon={Shield}
            title="Admin Dashboard"
            description="Manage system settings"
          />

          <Separator />

          <PageHeader
            icon={Users}
            title="Applications"
            breadcrumbs={[
              { label: "Dashboard", href: "/" },
              { label: "Jobs", href: "/jobs" },
              { label: "Applications" }
            ]}
            actions={
              <div className="flex gap-2">
                <Button variant="outline" size="sm">Export</Button>
                <Button size="sm">Add New</Button>
              </div>
            }
          />

          <Separator />

          <PageHeader
            icon={Briefcase}
            title="Job Title Here"
            description="Company Name • Location • Full-time"
          />
        </div>
      </Section>

      <Separator className="my-8" />

      {/* Workspace density (Wave 3.5B) */}
      <Section>
        <h2 className="text-xl font-semibold text-foreground mb-4">Workspace Density</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Compact internal header and job navigation. At 1440×900 the header stays within 176px (120px without
          actions/stats) and the first work surface begins above 360px; at 390×844 nothing overflows horizontally.
        </p>
        <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
          <InternalHero
            eyebrow="Job Workspace"
            title="Senior Backend Engineer"
            subtitle="Compact hero: eyebrow, title, subtitle and actions on one row; stats as chips."
            badge="Active"
            tone="green"
            actions={
              <>
                <Button variant="outline" size="sm">Edit</Button>
                <Button size="sm">Find candidates</Button>
              </>
            }
            stats={[
              { label: "Applications", value: 42 },
              { label: "Shortlisted", value: 7, accentClassName: "text-[#16A34A]" },
              { label: "To review", value: 12, accentClassName: "text-[#D97706]" },
            ]}
          />
          <JobSubNav jobId={0} />
          <InternalEmptyState
            icon={Users}
            title="No candidates yet"
            description="Compact empty state: same shell and origin as loaded content."
            actions={<Button size="sm">Find candidates</Button>}
          />
        </div>
      </Section>

      <Separator className="my-8" />

      {/* Migration Guide */}
      <Section>
        <h2 className="text-xl font-semibold text-foreground mb-4">Migration Guide</h2>
        <Card>
          <CardHeader>
            <CardTitle>Color Token Replacements</CardTitle>
            <CardDescription>Use these semantic tokens instead of hardcoded colors</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="font-mono text-sm space-y-2">
              <p><span className="text-muted-foreground">text-foreground</span> → <span className="text-foreground font-medium">text-foreground</span></p>
              <p><span className="text-muted-foreground">text-muted-foreground/600</span> → <span className="text-muted-foreground font-medium">text-muted-foreground</span></p>
              <p><span className="text-muted-foreground">bg-white/bg-slate-50</span> → <span className="text-foreground font-medium">bg-card / bg-background</span></p>
              <p><span className="text-muted-foreground">border-slate-200</span> → <span className="text-foreground font-medium">border-border</span></p>
              <p><span className="text-muted-foreground">text-green-700</span> → <span className="text-success-foreground font-medium">text-success-foreground</span></p>
              <p><span className="text-muted-foreground">bg-green-50</span> → <span className="text-foreground font-medium">bg-success/10</span></p>
              <p><span className="text-muted-foreground">text-red-700</span> → <span className="text-destructive font-medium">text-destructive</span></p>
              <p><span className="text-muted-foreground">text-blue-700</span> → <span className="text-info-foreground font-medium">text-info-foreground</span></p>
              <p><span className="text-muted-foreground">text-yellow/amber-700</span> → <span className="text-warning-foreground font-medium">text-warning-foreground</span></p>
            </div>
          </CardContent>
        </Card>
      </Section>
    </PageShell>
  );
}

function ColorSwatch({
  name,
  className,
  textLight = false
}: {
  name: string;
  className: string;
  textLight?: boolean;
}) {
  return (
    <div className={`h-20 rounded-lg flex items-end p-2 ${className}`}>
      <span className={`text-xs font-medium ${textLight ? "text-white" : "text-foreground"}`}>
        {name}
      </span>
    </div>
  );
}
