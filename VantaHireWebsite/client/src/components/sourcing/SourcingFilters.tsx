import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SlidersHorizontal } from "lucide-react";

export interface SourcingFilterState {
  identityStatus: "all" | "verified" | "review" | "weak";
  enrichedOnly: boolean;
  location: string;
  seniority: string;
  candidateState: "all" | "new" | "shortlisted" | "hidden";
}

export const defaultFilters: SourcingFilterState = {
  identityStatus: "all",
  enrichedOnly: false,
  location: "",
  seniority: "all",
  candidateState: "all",
};

interface SourcingFiltersProps {
  filters: SourcingFilterState;
  onChange: (filters: SourcingFilterState) => void;
  sortBy: string;
  onSortChange: (sort: string) => void;
  resultCount: number;
  totalCount: number;
  bestMatchesOnly: boolean;
  onBestMatchesOnlyChange: (checked: boolean) => void;
  hasTierData?: boolean;
  /** True when tierModel is explicit but all candidates are broader_pool (0 best matches). */
  allBroader?: boolean;
}

export function SourcingFilters({
  filters,
  onChange,
  sortBy,
  onSortChange,
  resultCount,
  totalCount,
  bestMatchesOnly,
  onBestMatchesOnlyChange,
  hasTierData = true,
  allBroader = false,
}: SourcingFiltersProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const update = (partial: Partial<SourcingFilterState>) =>
    onChange({ ...filters, ...partial });

  return (
    <Card className="shadow-sm">
      <CardContent className="p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">


          <Input
            placeholder="Location"
            value={filters.location}
            onChange={(e) => update({ location: e.target.value })}
            className="w-44 h-8 text-sm"
          />

          <Select
            value={filters.seniority}
            onValueChange={(val) => update({ seniority: val })}
          >
            <SelectTrigger className="w-36 h-8 text-sm">
              <SelectValue placeholder="Seniority" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All seniority</SelectItem>
              <SelectItem value="junior">Junior</SelectItem>
              <SelectItem value="mid">Mid</SelectItem>
              <SelectItem value="senior">Senior</SelectItem>
              <SelectItem value="lead">Lead</SelectItem>
              <SelectItem value="executive">Executive</SelectItem>
            </SelectContent>
          </Select>

          <Select value={sortBy} onValueChange={onSortChange}>
            <SelectTrigger className="w-40 h-8 text-sm">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="rank">Sort: Recommended</SelectItem>
              <SelectItem value="fitScore">Sort: Fit score</SelectItem>
              <SelectItem value="freshness">Sort: Freshness</SelectItem>
              <SelectItem value="source">Sort: Source type</SelectItem>
            </SelectContent>
          </Select>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8"
            onClick={() => setShowAdvanced((v) => !v)}
          >
            <SlidersHorizontal className="h-3.5 w-3.5 mr-1" />
            More filters
          </Button>

          <span className="text-xs text-muted-foreground ml-auto whitespace-nowrap">
            Showing {resultCount} of {totalCount}
          </span>
        </div>

        {showAdvanced && (
          <div className="border rounded-md p-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Identity</Label>
              <Select
                value={filters.identityStatus}
                onValueChange={(val) =>
                  update({ identityStatus: val as SourcingFilterState["identityStatus"] })
                }
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="verified">Confirmed</SelectItem>
                  <SelectItem value="review">Needs Review</SelectItem>
                  <SelectItem value="weak">Unconfirmed</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">State</Label>
              <Select
                value={filters.candidateState}
                onValueChange={(val) =>
                  update({ candidateState: val as SourcingFilterState["candidateState"] })
                }
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="new">New</SelectItem>
                  <SelectItem value="shortlisted">Shortlisted</SelectItem>
                  <SelectItem value="hidden">Hidden</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between rounded-md border px-2 py-1.5 mt-5 sm:mt-0">
              <Label htmlFor="enriched-only" className="text-xs text-muted-foreground">
                Verified profiles only
              </Label>
              <Switch
                id="enriched-only"
                checked={filters.enrichedOnly}
                onCheckedChange={(checked) => update({ enrichedOnly: checked })}
              />
            </div>

            <div className="sm:col-span-3 flex justify-end">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onChange(defaultFilters)}
              >
                Reset filters
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
