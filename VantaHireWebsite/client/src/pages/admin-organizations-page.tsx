import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import Layout from "@/components/Layout";
import { useAuth } from "@/hooks/use-auth";
import { Redirect, Link } from "wouter";
import {
  Building2,
  Users,
  Search,
  CheckCircle,
  XCircle,
  Globe,
  Loader2,
  ExternalLink,
  Crown,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";

interface OrganizationSummary {
  id: number;
  name: string;
  slug: string;
  domain: string | null;
  domainVerified: boolean;
  isActive: boolean;
  createdAt: string;
  memberCount: number;
  subscription: {
    planName: string;
    seats: number;
    status: string;
    currentPeriodEnd: string | null;
  };
}

interface OrganizationsResponse {
  organizations: OrganizationSummary[];
  total: number;
  page: number;
  totalPages: number;
}

export default function AdminOrganizationsPage() {
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");

  // Fetch organizations
  const { data, isLoading } = useQuery<OrganizationsResponse>({
    queryKey: ['admin', 'organizations', page],
    queryFn: async () => {
      const res = await fetch(`/api/admin/organizations?page=${page}&limit=20`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch organizations');
      return res.json();
    },
    staleTime: 1000 * 30,
  });

  // Auth check
  if (authLoading) {
    return (
      <Layout>
        <div className="flex justify-center items-center h-64">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </Layout>
    );
  }

  if (!user || user.role !== 'super_admin') {
    return <Redirect to="/admin" />;
  }

  // Filter organizations by search
  const filteredOrgs = data?.organizations.filter(org =>
    org.name.toLowerCase().includes(search.toLowerCase()) ||
    org.slug.toLowerCase().includes(search.toLowerCase()) ||
    (org.domain && org.domain.toLowerCase().includes(search.toLowerCase()))
  ) || [];

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <Badge variant="default" className="bg-green-500">Active</Badge>;
      case 'past_due':
        return <Badge variant="destructive">Past Due</Badge>;
      case 'cancelled':
        return <Badge variant="secondary">Cancelled</Badge>;
      case 'trialing':
        return <Badge variant="outline" className="text-blue-600 border-blue-200">Trial</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const getPlanBadge = (planName: string) => {
    if (planName === 'Free') {
      return <Badge variant="outline">{planName}</Badge>;
    }
    if (planName.includes('Growth') || planName.includes('Pro')) {
      return <Badge variant="default" className="bg-[#4B8EF0]">{planName}</Badge>;
    }
    return <Badge variant="secondary">{planName}</Badge>;
  };

  return (
    <Layout>
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Building2 className="h-6 w-6" />
            Organizations
          </h1>
          <p className="text-muted-foreground">
            Manage all organizations on the platform
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                  <Building2 className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{data?.total || 0}</p>
                  <p className="text-sm text-muted-foreground">Total Organizations</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                  <CheckCircle className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">
                    {data?.organizations.filter(o => o.subscription.status === 'active').length || 0}
                  </p>
                  <p className="text-sm text-muted-foreground">Active Subscriptions</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#EEF5FF]">
                  <Crown className="h-5 w-5 text-[#4B8EF0]" />
                </div>
                <div>
                  <p className="text-2xl font-bold">
                    {data?.organizations.filter(o => o.subscription.planName !== 'Free').length || 0}
                  </p>
                  <p className="text-sm text-muted-foreground">Paid Plans</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Search */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search organizations..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Organizations Table */}
        <Card>
          <CardHeader>
            <CardTitle>All Organizations</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : filteredOrgs.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Building2 className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No organizations found</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Organization</TableHead>
                    <TableHead>Domain</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Members</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="w-[80px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredOrgs.map((org) => (
                    <TableRow key={org.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{org.name}</p>
                          <p className="text-sm text-muted-foreground">/{org.slug}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        {org.domain ? (
                          <div className="flex items-center gap-2">
                            <Globe className="h-4 w-4 text-muted-foreground" />
                            <span>{org.domain}</span>
                            {org.domainVerified && (
                              <CheckCircle className="h-4 w-4 text-green-500" />
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {getPlanBadge(org.subscription.planName)}
                          {org.subscription.seats > 1 && (
                            <span className="text-xs text-muted-foreground">
                              {org.subscription.seats} seats
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {getStatusBadge(org.subscription.status)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Users className="h-4 w-4 text-muted-foreground" />
                          <span>{org.memberCount}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDistanceToNow(new Date(org.createdAt), { addSuffix: true })}
                      </TableCell>
                      <TableCell>
                        <Link href={`/admin/organizations/${org.id}`}>
                          <Button variant="ghost" size="icon" aria-label={`View organization ${org.name}`}>
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {/* Pagination */}
            {data && data.totalPages > 1 && (
              <div className="flex justify-center gap-2 mt-4">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 1}
                  onClick={() => setPage(p => p - 1)}
                >
                  Previous
                </Button>
                <span className="flex items-center px-3 text-sm text-muted-foreground">
                  Page {page} of {data.totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= data.totalPages}
                  onClick={() => setPage(p => p + 1)}
                >
                  Next
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
