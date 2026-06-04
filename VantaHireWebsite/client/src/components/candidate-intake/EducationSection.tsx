import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { ChevronRight, Plus, Trash2, GraduationCap } from "lucide-react";
import { type EducationData, type EducationItem } from "./types";

interface EducationSectionProps {
  data: EducationData;
  onChange: (data: EducationData) => void;
  onValidChange: (isValid: boolean) => void;
  onContinue: () => void;
}

export function EducationSection({
  data,
  onChange,
  onValidChange,
  onContinue,
}: EducationSectionProps) {
  // Education is optional, so always valid
  useEffect(() => {
    onValidChange(true);
  }, [onValidChange]);

  const addEducation = () => {
    const newItem: EducationItem = {
      id: crypto.randomUUID(),
      school: "",
      degree: "",
      field: "",
      startDate: "",
      endDate: "",
      notes: "",
    };
    onChange({ items: [...data.items, newItem] });
  };

  const updateItem = (id: string, updates: Partial<EducationItem>) => {
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
        <h3 className="text-lg font-semibold text-foreground">Education</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Add the candidate's educational background (optional)
        </p>
      </div>

      {data.items.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-8 text-center">
            <GraduationCap className="h-10 w-10 text-muted-foreground/50 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground mb-4">
              No education added yet. Add educational history if relevant.
            </p>
            <Button variant="outline" onClick={addEducation}>
              <Plus className="h-4 w-4 mr-2" />
              Add Education
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
                    Education {index + 1}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => removeItem(item.id)}
                    aria-label={`Remove education ${index + 1}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                <div className="space-y-2">
                  <Label>School / Institution</Label>
                  <Input
                    value={item.school}
                    onChange={(e) => updateItem(item.id, { school: e.target.value })}
                    placeholder="University of California, Berkeley"
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Degree</Label>
                    <Input
                      value={item.degree}
                      onChange={(e) => updateItem(item.id, { degree: e.target.value })}
                      placeholder="Bachelor's, Master's, PhD..."
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Field of Study</Label>
                    <Input
                      value={item.field}
                      onChange={(e) => updateItem(item.id, { field: e.target.value })}
                      placeholder="Computer Science"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Start Year</Label>
                    <Input
                      type="number"
                      min="1950"
                      max="2030"
                      value={item.startDate}
                      onChange={(e) => updateItem(item.id, { startDate: e.target.value })}
                      placeholder="2018"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>End Year</Label>
                    <Input
                      type="number"
                      min="1950"
                      max="2030"
                      value={item.endDate}
                      onChange={(e) => updateItem(item.id, { endDate: e.target.value })}
                      placeholder="2022"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Notes / Honors</Label>
                  <Textarea
                    value={item.notes}
                    onChange={(e) => updateItem(item.id, { notes: e.target.value })}
                    placeholder="GPA, honors, relevant coursework..."
                    rows={2}
                  />
                </div>
              </CardContent>
            </Card>
          ))}

          <Button variant="outline" onClick={addEducation} className="w-full">
            <Plus className="h-4 w-4 mr-2" />
            Add Another Education
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
