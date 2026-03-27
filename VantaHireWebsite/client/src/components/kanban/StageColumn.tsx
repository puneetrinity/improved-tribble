import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Application, PipelineStage } from "@shared/schema";
import { ApplicationCard } from "./ApplicationCard";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronRight } from "lucide-react";

const candidateListScrollClass =
  "max-h-[420px] overflow-y-auto pr-1 [scrollbar-width:none] hover:[scrollbar-width:thin] [&::-webkit-scrollbar]:w-0 hover:[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent hover:[&::-webkit-scrollbar-track]:bg-muted/30 [&::-webkit-scrollbar-thumb]:bg-transparent hover:[&::-webkit-scrollbar-thumb]:bg-border";

export interface StageColumnProps {
  stage: PipelineStage;
  applications: Application[];
  selectedIds: number[];
  onToggleSelect: (id: number) => void;
  onOpenDetails: (application: Application, contextApplications?: Application[]) => void;
  pipelineStages?: PipelineStage[] | undefined;
  onQuickMoveStage?: ((applicationId: number, stageId: number) => void) | undefined;
  onQuickEmail?: ((applicationId: number) => void) | undefined;
  onQuickInterview?: ((applicationId: number) => void) | undefined;
  onQuickDownload?: ((applicationId: number) => void) | undefined;
  onToggleStageSelect?: ((stageId: number | null, shouldSelect: boolean) => void) | undefined;
}

// Categorize applications into sub-sections
function categorizeApplications(applications: Application[]) {
  const active: Application[] = [];
  const advanced: Application[] = [];
  const archived: Application[] = [];

  applications.forEach(app => {
    // Archived: rejected or explicitly marked
    if (app.status === 'rejected') {
      archived.push(app);
    }
    // Advanced: shortlisted or downloaded (showing strong interest)
    else if (app.status === 'shortlisted' || app.status === 'downloaded') {
      advanced.push(app);
    }
    // Active: submitted, reviewed, or any other active status
    else {
      active.push(app);
    }
  });

  return { active, advanced, archived };
}

// Sub-section component
function SubSection({
  label,
  applications,
  selectedIds,
  onToggleSelect,
  onOpenDetails,
  pipelineStages,
  onQuickMoveStage,
  onQuickEmail,
  onQuickInterview,
  onQuickDownload,
  colorClass,
  defaultExpanded = true,
}: {
  label: string;
  applications: Application[];
  selectedIds: number[];
  onToggleSelect: (id: number) => void;
  onOpenDetails: (application: Application, contextApplications?: Application[]) => void;
  pipelineStages?: PipelineStage[] | undefined;
  onQuickMoveStage?: ((applicationId: number, stageId: number) => void) | undefined;
  onQuickEmail?: ((applicationId: number) => void) | undefined;
  onQuickInterview?: ((applicationId: number) => void) | undefined;
  onQuickDownload?: ((applicationId: number) => void) | undefined;
  colorClass: string;
  defaultExpanded?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  if (applications.length === 0) return null;

  return (
    <div className="mb-3">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          "w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs font-medium transition-colors",
          colorClass
        )}
      >
        {isExpanded ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        <span>{label}</span>
        <Badge variant="secondary" className="ml-auto text-xs px-1.5 py-0 h-5">
          {applications.length}
        </Badge>
      </button>
      {isExpanded && (
        <div className={cn("mt-1.5", candidateListScrollClass)}>
          <div className="space-y-2">
            {applications.map((application) => (
              <ApplicationCard
                key={application.id}
                application={application}
                isSelected={selectedIds.includes(application.id)}
                onToggleSelect={onToggleSelect}
                onOpenDetails={onOpenDetails}
                contextApplications={applications}
                pipelineStages={pipelineStages}
                onQuickMoveStage={onQuickMoveStage}
                onQuickEmail={onQuickEmail}
                onQuickInterview={onQuickInterview}
                onQuickDownload={onQuickDownload}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function StageColumn({
  stage,
  applications,
  selectedIds,
  onToggleSelect,
  onOpenDetails,
  pipelineStages = [],
  onQuickMoveStage,
  onQuickEmail,
  onQuickInterview,
  onQuickDownload,
  onToggleStageSelect,
}: StageColumnProps) {
  // Make Unassigned column (id === 0) read-only - server requires positive stageId
  const isUnassigned = stage.id === 0;

  const { setNodeRef, isOver } = useDroppable({
    id: `stage-${stage.id}`,
    data: {
      type: "stage",
      stageId: stage.id,
    },
    disabled: isUnassigned,
  });

  // Check if all applications in this stage are selected
  const areAllSelected = applications.length > 0 && applications.every(app => selectedIds.includes(app.id));

  // Categorize applications into sub-sections
  const { active, advanced, archived } = categorizeApplications(applications);
  const hasMultipleCategories = [active, advanced, archived].filter(arr => arr.length > 0).length > 1;

  return (
    <div className="flex flex-col h-full">
      <Card
        className={cn(
          "flex flex-col h-full",
          isOver && !isUnassigned && "ring-2 ring-primary/60",
          isUnassigned && "opacity-75"
        )}
      >
        <CardHeader className="pb-3 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {applications.length > 0 && onToggleStageSelect && (
                <Checkbox
                  checked={areAllSelected}
                  onCheckedChange={(checked) => {
                    const stageId = stage.id === 0 ? null : stage.id;
                    onToggleStageSelect(stageId, checked === true);
                  }}
                  className="mr-1"
                />
              )}
              <CardTitle className="text-foreground text-base font-semibold flex items-center gap-2">
                {stage.name}
                {isUnassigned && (
                  <span className="text-xs text-muted-foreground font-normal">(read-only)</span>
                )}
              </CardTitle>
            </div>
            <Badge
              variant="secondary"
              className="bg-muted text-foreground border-border"
            >
              {applications.length}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="flex-1 overflow-y-auto min-h-[200px] p-3">
          <div ref={setNodeRef} className="min-h-full">
            {applications.length === 0 ? (
              <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
                No applications
              </div>
            ) : hasMultipleCategories ? (
              // Show sub-sections when there are multiple categories
              <>
                <SubSection
                  label="Active"
                  applications={active}
                  selectedIds={selectedIds}
                  onToggleSelect={onToggleSelect}
                  onOpenDetails={onOpenDetails}
                  pipelineStages={pipelineStages}
                  onQuickMoveStage={onQuickMoveStage}
                  onQuickEmail={onQuickEmail}
                  onQuickInterview={onQuickInterview}
                  onQuickDownload={onQuickDownload}
                  colorClass="bg-info/10 text-info-foreground hover:bg-info/20"
                />
                <SubSection
                  label="Advanced"
                  applications={advanced}
                  selectedIds={selectedIds}
                  onToggleSelect={onToggleSelect}
                  onOpenDetails={onOpenDetails}
                  pipelineStages={pipelineStages}
                  onQuickMoveStage={onQuickMoveStage}
                  onQuickEmail={onQuickEmail}
                  onQuickInterview={onQuickInterview}
                  onQuickDownload={onQuickDownload}
                  colorClass="bg-success/10 text-success-foreground hover:bg-success/20"
                />
                <SubSection
                  label="Archived"
                  applications={archived}
                  selectedIds={selectedIds}
                  onToggleSelect={onToggleSelect}
                  onOpenDetails={onOpenDetails}
                  pipelineStages={pipelineStages}
                  onQuickMoveStage={onQuickMoveStage}
                  onQuickEmail={onQuickEmail}
                  onQuickInterview={onQuickInterview}
                  onQuickDownload={onQuickDownload}
                  colorClass="bg-muted text-muted-foreground hover:bg-muted"
                  defaultExpanded={false}
                />
              </>
            ) : (
              // Show flat list when only one category
              <div className={candidateListScrollClass}>
                <div className="space-y-2">
                  {applications.map((application) => (
                    <ApplicationCard
                      key={application.id}
                      application={application}
                      isSelected={selectedIds.includes(application.id)}
                      onToggleSelect={onToggleSelect}
                      onOpenDetails={onOpenDetails}
                      contextApplications={applications}
                      pipelineStages={pipelineStages}
                      onQuickMoveStage={onQuickMoveStage}
                      onQuickEmail={onQuickEmail}
                      onQuickInterview={onQuickInterview}
                      onQuickDownload={onQuickDownload}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
