import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import Layout from "@/components/Layout";
import { useAuth } from "@/hooks/use-auth";
import { Redirect } from "wouter";
import {
  CreditCard,
  Building2,
  Loader2,
  Plus,
  Calendar,
  TrendingUp,
  Users,
  DollarSign,
  Settings,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { formatPriceINR } from "@/hooks/use-subscription";
import { adminSubscriptionsPageCopy } from "@/lib/internal-copy";

interface Subscription {
  id: number;
  seats: number;
  billingCycle: string;
  status: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  organization: {
    id: number;
    name: string;
    slug: string;
  };
  plan: {
    id: number;
    name: string;
    displayName: string;
    pricePerSeatMonthly: number;
    pricePerSeatAnnual: number;
  };
}

interface SubscriptionsResponse {
  subscriptions: Subscription[];
  total: number;
  page: number;
  totalPages: number;
}

interface SubscriptionAnalytics {
  mrr: number;
  activeSubscriptions: number;
  totalSeats: number;
  totalPaidSeats: number;
  planDistribution: Array<{ planName: string; count: number }>;
  statusDistribution: Array<{ status: string; count: number }>;
}

export default function AdminSubscriptionsPage() {
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();

  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [extendDialogOpen, setExtendDialogOpen] = useState(false);
  const [selectedSub, setSelectedSub] = useState<Subscription | null>(null);
  const [extendDays, setExtendDays] = useState("30");
  const [extendReason, setExtendReason] = useState("");

  // Fetch subscriptions
  const { data, isLoading } = useQuery<SubscriptionsResponse>({
    queryKey: ['admin', 'subscriptions', page, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ page: page.toString(), limit: '20' });
      if (statusFilter !== 'all') params.set('status', statusFilter);
      const res = await fetch(`/api/admin/subscriptions?${params}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch subscriptions');
      return res.json();
    },
    staleTime: 1000 * 30,
  });

  // Fetch analytics
  const { data: analytics } = useQuery<SubscriptionAnalytics>({
    queryKey: ['admin', 'analytics', 'subscriptions'],
    queryFn: async () => {
      const res = await fetch('/api/admin/analytics/subscriptions', {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch analytics');
      return res.json();
    },
    staleTime: 1000 * 60,
  });

  // Extend subscription
  const extendMutation = useMutation({
    mutationFn: async ({ subscriptionId, days, reason }: {
      subscriptionId: number;
      days: number;
      reason: string;
    }) => {
      return apiRequest('POST', `/api/admin/subscriptions/${subscriptionId}/extend`, { days, reason });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'subscriptions'] });
      toast({
        title: adminSubscriptionsPageCopy.toasts.successTitle,
        description: `Subscription extended by ${extendDays} days.`,
      });
      setExtendDialogOpen(false);
      setSelectedSub(null);
      setExtendDays("30");
      setExtendReason("");
    },
    onError: (error: any) => {
      toast({
        title: adminSubscriptionsPageCopy.toasts.errorTitle,
        description: error.message || adminSubscriptionsPageCopy.toasts.errorDescription,
        variant: "destructive",
      });
    },
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

  const getStatusBadge = (status: string, cancelAtPeriodEnd: boolean) => {
    if (cancelAtPeriodEnd) {
      return <Badge variant="outline" className="text-amber-600 border-amber-200">Cancelling</Badge>;
    }
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

  const handleExtend = (sub: Subscription) => {
    setSelectedSub(sub);
    setExtendDialogOpen(true);
  };

  const confirmExtend = () => {
    if (!selectedSub) return;
    extendMutation.mutate({
      subscriptionId: selectedSub.id,
      days: parseInt(extendDays),
      reason: extendReason,
    });
  };

  return (
    <Layout>
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <CreditCard className="h-6 w-6" />
            {adminSubscriptionsPageCopy.header.title}
          </h1>
          <p className="text-muted-foreground">
            {adminSubscriptionsPageCopy.header.subtitle}
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                  <DollarSign className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">
                    {analytics ? formatPriceINR(analytics.mrr) : '-'}
                  </p>
                  <p className="text-sm text-muted-foreground">{adminSubscriptionsPageCopy.stats.mrr}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                  <TrendingUp className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{analytics?.activeSubscriptions || 0}</p>
                  <p className="text-sm text-muted-foreground">{adminSubscriptionsPageCopy.stats.activeSubscriptions}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#EEF5FF]">
                  <Users className="h-5 w-5 text-[#4B8EF0]" />
                </div>
                <div>
                  <p className="text-2xl font-bold">
                    {analytics?.totalPaidSeats || 0}
                    <span className="text-sm font-normal text-muted-foreground ml-1">
                      / {analytics?.totalSeats || 0}
                    </span>
                  </p>
                  <p className="text-sm text-muted-foreground">Paid / Total Seats</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center">
                  <Building2 className="h-5 w-5 text-amber-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{data?.total || 0}</p>
                  <p className="text-sm text-muted-foreground">{adminSubscriptionsPageCopy.stats.totalSubscriptions}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Plan Distribution */}
        {analytics?.planDistribution && analytics.planDistribution.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{adminSubscriptionsPageCopy.stats.planDistribution}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-4">
                {analytics.planDistribution.map((item) => (
                  <div key={item.planName} className="flex items-center gap-2">
                    <Badge variant="outline">{item.planName}</Badge>
                    <span className="text-sm font-medium">{item.count}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Filters */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex gap-4">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder={adminSubscriptionsPageCopy.filters.statusPlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{adminSubscriptionsPageCopy.filters.allStatuses}</SelectItem>
                  <SelectItem value="active">{adminSubscriptionsPageCopy.filters.active}</SelectItem>
                  <SelectItem value="past_due">{adminSubscriptionsPageCopy.filters.pastDue}</SelectItem>
                  <SelectItem value="cancelled">{adminSubscriptionsPageCopy.filters.cancelled}</SelectItem>
                  <SelectItem value="trialing">{adminSubscriptionsPageCopy.filters.trial}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Subscriptions Table */}
        <Card>
          <CardHeader>
            <CardTitle>{adminSubscriptionsPageCopy.list.title}</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : (data?.subscriptions?.length || 0) === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <CreditCard className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>{adminSubscriptionsPageCopy.list.empty}</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Organization</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Seats</TableHead>
                    <TableHead>Billing</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Period End</TableHead>
                    <TableHead className="w-[80px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.subscriptions.map((sub) => (
                    <TableRow key={sub.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{sub.organization.name}</p>
                          <p className="text-sm text-muted-foreground">/{sub.organization.slug}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{sub.plan.displayName}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Users className="h-4 w-4 text-muted-foreground" />
                          <span>{sub.seats}</span>
                        </div>
                      </TableCell>
                      <TableCell className="capitalize">
                        {sub.billingCycle}
                      </TableCell>
                      <TableCell>
                        {getStatusBadge(sub.status, sub.cancelAtPeriodEnd)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {format(new Date(sub.currentPeriodEnd), 'MMM d, yyyy')}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleExtend(sub)}
                          title="Extend subscription"
                          aria-label={`Extend subscription for ${sub.organization.name}`}
                        >
                          <Calendar className="h-4 w-4" />
                        </Button>
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

        {/* Extend Dialog */}
        <Dialog open={extendDialogOpen} onOpenChange={setExtendDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                Extend Subscription
              </DialogTitle>
              <DialogDescription>
                {selectedSub && (
                  <>
                    Extend the subscription for <strong>{selectedSub.organization.name}</strong>
                  </>
                )}
              </DialogDescription>
            </DialogHeader>

            <div className="py-4 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="extendDays">Days to extend</Label>
                <Input
                  id="extendDays"
                  type="number"
                  min="1"
                  max="365"
                  value={extendDays}
                  onChange={(e) => setExtendDays(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="extendReason">Reason (required)</Label>
                <Textarea
                  id="extendReason"
                  placeholder="Explain why this subscription is being extended..."
                  value={extendReason}
                  onChange={(e) => setExtendReason(e.target.value)}
                  rows={3}
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setExtendDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={confirmExtend}
                disabled={extendMutation.isPending || !extendReason.trim() || parseInt(extendDays) < 1}
              >
                {extendMutation.isPending && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                Extend Subscription
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}
