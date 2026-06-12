import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export interface OutreachDraftItem {
  candidateId: number;
  name: string;
  email: string;
  subject: string;
  body: string;
  aiDraftSubject: string;
  aiDraftBody: string;
  wasEdited: boolean;
}

interface OutreachDraftCardProps {
  draft: OutreachDraftItem;
  onChange: (next: OutreachDraftItem) => void;
}

const HTML_SNIPPETS = [
  { label: "Paragraph", value: "<p>Your message here.</p>" },
  { label: "Bold", value: "<strong>Highlight text</strong>" },
  { label: "List", value: "<ul><li>Point one</li><li>Point two</li></ul>" },
  { label: "Link", value: '<a href="https://example.com">View role</a>' },
];

export function OutreachDraftCard({ draft, onChange }: OutreachDraftCardProps) {
  const statusLabel = useMemo(() => (
    draft.wasEdited ? "Edited" : "AI Draft"
  ), [draft.wasEdited]);

  const updateDraft = (subject: string, body: string) => {
    onChange({
      ...draft,
      subject,
      body,
      wasEdited: subject !== draft.aiDraftSubject || body !== draft.aiDraftBody,
    });
  };

  return (
    <div className="rounded-xl border bg-card p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium truncate">{draft.name}</p>
          <p className="text-xs text-muted-foreground truncate">{draft.email}</p>
        </div>
        <Badge variant="outline">{statusLabel}</Badge>
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Subject</Label>
        <Input
          value={draft.subject}
          onChange={(e) => updateDraft(e.target.value, draft.body)}
        />
      </div>

      <Tabs defaultValue="editor" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="editor">Edit HTML</TabsTrigger>
            <TabsTrigger value="preview">Preview</TabsTrigger>
          </TabsList>
          <div className="flex flex-wrap gap-2">
            {HTML_SNIPPETS.map((snippet) => (
              <Button
                key={snippet.label}
                type="button"
                size="sm"
                variant="outline"
                onClick={() => updateDraft(draft.subject, `${draft.body}\n${snippet.value}`.trim())}
              >
                {snippet.label}
              </Button>
            ))}
          </div>
        </div>

        <TabsContent value="editor" className="space-y-2">
          <Label className="text-xs text-muted-foreground">HTML body</Label>
          <Textarea
            value={draft.body}
            className="min-h-56 font-mono text-xs"
            onChange={(e) => updateDraft(draft.subject, e.target.value)}
          />
        </TabsContent>

        <TabsContent value="preview" className="space-y-2">
          <Label className="text-xs text-muted-foreground">Rendered preview</Label>
          <div
            className="min-h-56 rounded-lg border bg-white p-4 text-sm text-slate-900"
            dangerouslySetInnerHTML={{ __html: draft.body }}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
