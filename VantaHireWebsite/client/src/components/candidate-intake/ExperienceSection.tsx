import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { ChevronRight, Plus, Trash2, Briefcase } from "lucide-react";
import { type ExperienceData, type ExperienceItem } from "./types";

interface ExperienceSectionProps {
  data: ExperienceData;
  onChange: (data: ExperienceData) => void;
  onValidChange: (isValid: boolean) => void;
  onContinue: () => void;
}

export function ExperienceSection({
  data,
  onChange,
  onValidChange,
  onContinue,
}: ExperienceSectionProps) {
  // Experience is optional, so always valid
  useEffect(() => {
    onValidChange(true);
  }, [onValidChange]);

  const addExperience = () => {
    const newItem: ExperienceItem = {
      id: crypto.randomUUID(),
      role: "",
      company: "",
      startDate: "",
      endDate: "",
      current: false,
      summary: "",
    };
    onChange({ items: [...data.items, newItem] });
  };

  const updateItem = (id: string, updates: Partial<ExperienceItem>) => {
    onChange({
      items: data.items.map((item) =>
        item.id === id ? { ...item, ...updates } : item
      ),
    });
  };

  const removeItem = (id: string) => {
    onChange({ items: data.items.filter((item) => item.id !== id) });
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-foreground">Work Experience</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Add the candidate's relevant work history (optional)
        </p>
      </div>

      {data.items.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-8 text-center">
            <Briefcase className="h-10 w-10 text-muted-foreground/50 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground mb-4">
              No experience added yet. Add work history to build a complete profile.
            </p>
            <Button variant="outline" onClick={addExperience}>
              <Plus className="h-4 w-4 mr-2" />
              Add Experience
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {data.items.map((item, index) => (
            <Card key={item.id}>
              <CardContent className="p-4 space-y-4">
                <div className="flex items-start justify-between">
                  <span className="text-sm font-medium text-muted-foreground">
                    Experience {index + 1}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => removeItem(item.id)}
                    aria-label={`Remove experience ${index + 1}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Role / Title</Label>
                    <Input
                      value={item.role}
                      onChange={(e) => updateItem(item.id, { role: e.target.value })}
                      placeholder="Software Engineer"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Company</Label>
                    <Input
                      value={item.company}
                      onChange={(e) => updateItem(item.id, { company: e.target.value })}
                      placeholder="Acme Inc."
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Start Date</Label>
                    <Input
                      type="month"
                      value={item.startDate}
                      onChange={(e) => updateItem(item.id, { startDate: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>End Date</Label>
                    <Input
                      type="month"
                      value={item.endDate}
                      onChange={(e) => updateItem(item.id, { endDate: e.target.value })}
                      disabled={item.current}
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Checkbox
                    id={`current-${item.id}`}
                    checked={item.current}
                    onCheckedChange={(checked) =>
                      updateItem(item.id, {
                        current: !!checked,
                        endDate: checked ? "" : item.endDate,
                      })
                    }
                  />
                  <Label htmlFor={`current-${item.id}`} className="text-sm font-normal">
                    Currently working here
                  </Label>
                </div>

                <div className="space-y-2">
                  <Label>Summary / Achievements</Label>
                  <Textarea
                    value={item.summary}
                    onChange={(e) => updateItem(item.id, { summary: e.target.value })}
                    placeholder="Key responsibilities and achievements..."
                    rows={3}
                  />
                </div>
              </CardContent>
            </Card>
          ))}

          <Button variant="outline" onClick={addExperience} className="w-full">
            <Plus className="h-4 w-4 mr-2" />
            Add Another Experience
          </Button>
        </div>
      )}

      <div className="pt-4 flex justify-end">
        <Button onClick={onContinue}>
          Continue
          <ChevronRight className="h-4 w-4 ml-2" />
        </Button>
      </div>
    </div>
  );
}
