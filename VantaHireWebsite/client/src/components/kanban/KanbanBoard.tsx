import { useMemo, useState } from "react";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCorners,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { Application, PipelineStage } from "@shared/schema";
import { StageColumn } from "./StageColumn";
import { ApplicationCard } from "./ApplicationCard";

interface KanbanBoardProps {
  applications: Application[];
  pipelineStages: PipelineStage[];
  selectedIds: number[];
  onToggleSelect: (id: number) => void;
  onOpenDetails: (application: Application, contextApplications?: Application[]) => void;
  onDragEnd: (applicationId: number, targetStageId: number) => Promise<void>;
  onDragCancel?: () => void;
  onQuickMoveStage?: (applicationId: number, stageId: number) => void;
  onQuickEmail?: (applicationId: number) => void;
  onQuickInterview?: (applicationId: number) => void;
  onQuickDownload?: (applicationId: number) => void;
  onToggleStageSelect?: (stageId: number | null, shouldSelect: boolean) => void;
}

export function KanbanBoard({
  applications,
  pipelineStages,
  selectedIds,
  onToggleSelect,
  onOpenDetails,
  onDragEnd,
  onDragCancel,
  onQuickMoveStage,
  onQuickEmail,
  onQuickInterview,
  onQuickDownload,
  onToggleStageSelect,
}: KanbanBoardProps) {
  const [activeApp, setActiveApp] = useState<Application | null>(null);

  // Configure sensors for drag and drop
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 8px movement required before drag starts (helps with clicks)
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Group applications by stage
  const columnMap = useMemo(() => {
    const map = new Map<number | null, Application[]>();

    // Initialize all stages with empty arrays
    pipelineStages.forEach((stage) => {
      map.set(stage.id, []);
    });

    // Add an "Unassigned" column for applications without a stage
    map.set(null, []);

    // Populate columns with applications
    applications.forEach((app) => {
      const stageId = app.currentStage;
      const existing = map.get(stageId) || [];
      map.set(stageId, [...existing, app]);
    });

    return map;
  }, [applications, pipelineStages]);

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const application = active.data.current?.application as Application;
    setActiveApp(application);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveApp(null);

    if (!over) return;

    // Extract source and target stage IDs
    const activeApplication = active.data.current?.application as Application;
    const sourceStageId = activeApplication.currentStage;

    // Determine target stage ID from the over target
    let targetStageId: number | null = null;

    if (over.data.current?.type === "stage") {
      targetStageId = over.data.current.stageId;
    } else if (over.data.current?.type === "application") {
      const overApplication = over.data.current.application as Application;
      targetStageId = overApplication.currentStage;
    }

    // Prevent dropping into Unassigned (id === 0) - server requires positive stageId
    if (targetStageId === 0) {
      return;
    }

    // If no valid target or same stage, do nothing
    if (targetStageId === null || targetStageId === sourceStageId) {
      return;
    }

    // Call the onDragEnd handler with optimistic update
    await onDragEnd(activeApplication.id, targetStageId);
  };

  const handleDragCancel = () => {
    setActiveApp(null);
    if (onDragCancel) {
      onDragCancel();
    }
  };

  // Create columns including "Unassigned" if there are any unassigned applications
  const unassignedApps = columnMap.get(null) || [];
  const hasUnassigned = unassignedApps.length > 0;

  const unassignedStage: PipelineStage = {
    id: 0, // Use 0 for unassigned to avoid conflicts
    name: "Unassigned",
    order: -1,
    color: "#64748b",
    isDefault: null,
    createdBy: null,
    createdAt: new Date(),
    organizationId: null,
  };

  const allColumns = hasUnassigned
    ? [unassignedStage, ...pipelineStages]
    : pipelineStages;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div
        className="grid gap-4 overflow-x-auto pb-4"
        style={{
          gridTemplateColumns: `repeat(${allColumns.length}, minmax(320px, 1fr))`,
        }}
      >
        {allColumns.map((stage) => {
          const stageId = stage.id === 0 ? null : stage.id;
          const apps = columnMap.get(stageId) || [];

          return (
            <StageColumn
              key={stage.id}
              stage={stage}
              applications={apps}
              selectedIds={selectedIds}
              onToggleSelect={onToggleSelect}
              onOpenDetails={onOpenDetails}
              pipelineStages={pipelineStages}
              onQuickMoveStage={onQuickMoveStage}
              onQuickEmail={onQuickEmail}
              onQuickInterview={onQuickInterview}
              onQuickDownload={onQuickDownload}
              onToggleStageSelect={onToggleStageSelect}
            />
          );
        })}
      </div>

      {/* Drag Overlay */}
      <DragOverlay>
        {activeApp ? (
          <div className="rotate-3 opacity-90">
            <ApplicationCard
              application={activeApp}
              isSelected={selectedIds.includes(activeApp.id)}
              onToggleSelect={() => {}}
              onOpenDetails={() => {}}
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
