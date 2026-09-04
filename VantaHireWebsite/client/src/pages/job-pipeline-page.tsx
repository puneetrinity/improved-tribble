import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Redirect } from "wouter";
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus, GripVertical, Trash2, Edit2, Check, X, AlertTriangle, Users, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Job, PipelineStage, Application } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import Layout from "@/components/Layout";
import { JobSubNav } from "@/components/JobSubNav";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageHeaderSkeleton } from "@/components/skeletons";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { jobPipelinePageCopy } from "@/lib/internal-copy";

// Sortable stage item component
function SortableStageItem({
  stage,
  index,
  isEditing,
  editingStageName,
  onEditChange,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onDelete,
  isUpdatePending,
  applicationCount,
}: {
  stage: PipelineStage;
  index: number;
  isEditing: boolean;
  editingStageName: string;
  onEditChange: (name: string) => void;
  onStartEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
  isUpdatePending: boolean;
  applicationCount: number;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: stage.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border border-border"
    >
      <button
        className="touch-none cursor-grab active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4 text-muted-foreground" />
      </button>
      <Badge variant="outline" className="text-xs">
        {index + 1}
      </Badge>

      {isEditing ? (
        <div className="flex-1 flex items-center gap-2">
          <Input
            value={editingStageName}
            onChange={(e) => onEditChange(e.target.value)}
            className="h-8"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") onSaveEdit();
              if (e.key === "Escape") onCancelEdit();
            }}
          />
          <Button
            size="sm"
            variant="ghost"
            onClick={onSaveEdit}
            disabled={isUpdatePending}
          >
            <Check className="h-4 w-4 text-success" />
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancelEdit}>
            <X className="h-4 w-4 text-muted-foreground" />
          </Button>
        </div>
      ) : (
        <>
          <span className="flex-1 font-medium text-foreground">{stage.name}</span>
          {applicationCount > 0 && (
            <Badge variant="secondary" className="text-xs bg-info/10 text-info-foreground">
              <Users className="h-3 w-3 mr-1" />
              {applicationCount}
            </Badge>
          )}
          <Button size="sm" variant="ghost" onClick={onStartEdit}>
            <Edit2 className="h-4 w-4 text-muted-foreground" />
          </Button>
          <Button size="sm" variant="ghost" onClick={onDelete}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </>
      )}
    </div>
  );
}

export default function JobPipelinePage() {
  const [match, params] = useRoute("/jobs/:id/pipeline");
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [isVisible, setIsVisible] = useState(false);
  const [editingStageId, setEditingStageId] = useState<number | null>(null);
  const [editingStageName, setEditingStageName] = useState("");
  const [newStageName, setNewStageName] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [stageToDelete, setStageToDelete] = useState<{ id: number; name: string; count: number } | null>(null);

  const jobId = params?.id ? parseInt(params.id) : null;

  // Configure sensors for drag and drop
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 200);
    return () => clearTimeout(timer);
  }, []);

  // Redirect if not recruiter or admin
  if (!user || !['recruiter', 'super_admin'].includes(user.role)) {
    return <Redirect to="/recruiter-auth" />;
  }

  const { data: job, isLoading: jobLoading } = useQuery<Job>({
    queryKey: ["/api/jobs", jobId],
    queryFn: async () => {
      const response = await fetch(`/api/jobs/${jobId}`);
      if (!response.ok) throw new Error("Failed to fetch job");
      return response.json();
    },
    enabled: !!jobId,
  });

  const { data: pipelineStages = [], isLoading: stagesLoading } = useQuery<PipelineStage[]>({
    queryKey: ["/api/pipeline/stages"],
    queryFn: async () => {
      const response = await fetch("/api/pipeline/stages");
      if (!response.ok) throw new Error("Failed to fetch pipeline stages");
      return response.json();
    },
  });

  // Fetch job applications to count per stage (job-scoped)
  const { data: jobApplications = [] } = useQuery<Application[]>({
    queryKey: ["/api/jobs", jobId, "applications"],
    queryFn: async () => {
      const response = await fetch(`/api/jobs/${jobId}/applications`);
      if (!response.ok) return [];
      return response.json();
    },
    enabled: !!jobId,
  });

  // Count applications per stage for this job
  const stageCounts = new Map<number, number>();
  jobApplications.forEach(app => {
    if (app.currentStage) {
      stageCounts.set(app.currentStage, (stageCounts.get(app.currentStage) || 0) + 1);
    }
  });

  const sortedStages = [...pipelineStages].sort((a, b) => (a.order - b.order) || (a.id - b.id));

  const createStageMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", "/api/pipeline/stages", {
        name,
        order: pipelineStages.length,
      });
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pipeline/stages"] });
      setNewStageName("");
      toast({
        title: jobPipelinePageCopy.toasts.createdTitle,
        description: jobPipelinePageCopy.toasts.createdDescription,
      });
    },
    onError: (error: Error) => {
      toast({
        title: jobPipelinePageCopy.toasts.createFailedTitle,
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateStageMutation = useMutation({
    mutationFn: async ({ id, name, order }: { id: number; name?: string; order?: number }) => {
      const res = await apiRequest("PATCH", `/api/pipeline/stages/${id}`, { name, order });
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pipeline/stages"] });
      setEditingStageId(null);
    },
    onError: (error: Error) => {
      toast({
        title: jobPipelinePageCopy.toasts.updateFailedTitle,
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const reorderStagesMutation = useMutation({
    mutationFn: async (stageIds: number[]) => {
      // Update each stage's order
      const updates = stageIds.map((id, index) =>
        apiRequest("PATCH", `/api/pipeline/stages/${id}`, { order: index })
      );
      await Promise.all(updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pipeline/stages"] });
      toast({
        title: jobPipelinePageCopy.toasts.reorderedTitle,
        description: jobPipelinePageCopy.toasts.reorderedDescription,
      });
    },
    onError: (error: Error) => {
      toast({
        title: jobPipelinePageCopy.toasts.reorderFailedTitle,
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteStageMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/pipeline/stages/${id}`);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pipeline/stages"] });
      setDeleteDialogOpen(false);
      setStageToDelete(null);
      toast({
        title: jobPipelinePageCopy.toasts.deletedTitle,
        description: jobPipelinePageCopy.toasts.deletedDescription,
      });
    },
    onError: (error: Error) => {
      toast({
        title: jobPipelinePageCopy.toasts.deleteFailedTitle,
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleAddStage = () => {
    if (!newStageName.trim()) return;
    createStageMutation.mutate(newStageName.trim());
  };

  const handleStartEdit = (stage: PipelineStage) => {
    setEditingStageId(stage.id);
    setEditingStageName(stage.name);
  };

  const handleSaveEdit = () => {
    if (!editingStageId || !editingStageName.trim()) return;
    updateStageMutation.mutate({ id: editingStageId, name: editingStageName.trim() });
    toast({
      title: jobPipelinePageCopy.toasts.updatedTitle,
      description: jobPipelinePageCopy.toasts.updatedDescription,
    });
  };

  const handleCancelEdit = () => {
    setEditingStageId(null);
    setEditingStageName("");
  };

  const handleDeleteClick = (stage: PipelineStage) => {
    const count = stageCounts.get(stage.id) || 0;
    setStageToDelete({ id: stage.id, name: stage.name, count });
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = () => {
    if (stageToDelete) {
      deleteStageMutation.mutate(stageToDelete.id);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = sortedStages.findIndex((s) => s.id === active.id);
      const newIndex = sortedStages.findIndex((s) => s.id === over.id);

      const reordered = arrayMove(sortedStages, oldIndex, newIndex);
      const newOrder = reordered.map((s) => s.id);
      reorderStagesMutation.mutate(newOrder);
    }
  };

  const isLoading = jobLoading || stagesLoading;

  if (isLoading) {
    return (
      <Layout>
        <div className="container mx-auto px-4 pb-10 pt-5">
          <div className="max-w-4xl mx-auto space-y-4">
            <PageHeaderSkeleton />
          </div>
        </div>
      </Layout>
    );
  }

  if (!job) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-8">
          <Card className="shadow-sm">
            <CardContent className="p-8 text-center">
              <h3 className="text-xl font-semibold text-foreground mb-2">{jobPipelinePageCopy.empty.title}</h3>
              <p className="text-muted-foreground">{jobPipelinePageCopy.empty.description}</p>
            </CardContent>
          </Card>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className={`container mx-auto px-4 pb-10 pt-5 transition-opacity duration-500 ${isVisible ? 'opacity-100' : 'opacity-0'}`}>
        <div className="max-w-4xl mx-auto">
          {/* Compact header: breadcrumb back-context + job title; the single job navigation follows */}
          <PageHeader
            title={job.title}
            breadcrumbs={[
              { label: "My jobs", href: "/my-jobs" },
              { label: "Applications", href: `/jobs/${jobId}/applications` },
              { label: job.title },
            ]}
            actions={
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setLocation(`/jobs/${jobId}/applications`)}
                className="text-muted-foreground hover:text-foreground hover:bg-muted"
              >
                <ArrowLeft className="h-4 w-4 mr-2" aria-hidden="true" />
                {jobPipelinePageCopy.back}
              </Button>
            }
            className="mb-3"
          />
          <JobSubNav jobId={jobId!} className="mb-4" />

          {/* Pipeline Stages */}
          <Card className="shadow-sm mb-6">
            <CardHeader>
              <CardTitle className="text-foreground">{jobPipelinePageCopy.panel.title}</CardTitle>
              <CardDescription>
                {jobPipelinePageCopy.panel.description}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {sortedStages.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  {jobPipelinePageCopy.panel.empty}
                </div>
              ) : (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext
                    items={sortedStages.map((s) => s.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="space-y-2">
                      {sortedStages.map((stage, index) => (
                        <SortableStageItem
                          key={stage.id}
                          stage={stage}
                          index={index}
                          isEditing={editingStageId === stage.id}
                          editingStageName={editingStageName}
                          onEditChange={setEditingStageName}
                          onStartEdit={() => handleStartEdit(stage)}
                          onSaveEdit={handleSaveEdit}
                          onCancelEdit={handleCancelEdit}
                          onDelete={() => handleDeleteClick(stage)}
                          isUpdatePending={updateStageMutation.isPending}
                          applicationCount={stageCounts.get(stage.id) || 0}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              )}

              {/* Add New Stage */}
              <div className="flex items-center gap-2 pt-4 border-t border-border">
                <Input
                  placeholder={jobPipelinePageCopy.panel.newStagePlaceholder}
                  value={newStageName}
                  onChange={(e) => setNewStageName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddStage()}
                />
                <Button
                  onClick={handleAddStage}
                  disabled={!newStageName.trim() || createStageMutation.isPending}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  {jobPipelinePageCopy.panel.addStage}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Stage Info */}
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-foreground text-base">{jobPipelinePageCopy.panel.aboutTitle}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="text-sm text-muted-foreground space-y-2">
                {jobPipelinePageCopy.panel.tips.map((tip) => (
                  <li key={tip}>• {tip}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              {stageToDelete && stageToDelete.count > 0 && (
                <AlertTriangle className="h-5 w-5 text-warning" />
              )}
              {jobPipelinePageCopy.deleteDialog.titlePrefix}{stageToDelete?.name}{jobPipelinePageCopy.deleteDialog.titleSuffix}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {stageToDelete && stageToDelete.count > 0 ? (
                <span className="text-warning">
                  {jobPipelinePageCopy.deleteDialog.withCandidatesPrefix} <strong>{stageToDelete.count} {stageToDelete.count === 1 ? jobPipelinePageCopy.deleteDialog.withCandidatesMiddle : jobPipelinePageCopy.deleteDialog.withCandidatesMiddlePlural}</strong>. {jobPipelinePageCopy.deleteDialog.withCandidatesSuffix}
                </span>
              ) : (
                jobPipelinePageCopy.deleteDialog.withoutCandidates
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{jobPipelinePageCopy.deleteDialog.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className={stageToDelete && stageToDelete.count > 0 ? "bg-amber-600 hover:bg-amber-700" : "bg-destructive hover:bg-destructive/80"}
            >
              {deleteStageMutation.isPending ? jobPipelinePageCopy.deleteDialog.deleting : jobPipelinePageCopy.deleteDialog.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}
