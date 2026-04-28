"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { AdminLayout } from "@/components/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import api from "@/lib/api";

interface DashboardData {
  users: { total: number; today: number; activeThisWeek: number };
  bookings: { total: number; byStatus: Record<string, number> };
  messages: { total: number; today: number };
}

function StatCard({ title, value, sub }: { title: string; value: number; sub?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-bold">{value.toLocaleString()}</p>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

const REFRESH_INTERVAL = 30_000;

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchData = () => {
    api.get("/dashboard").then((r) => {
      setData(r.data);
      setLoading(false);
      setLastUpdated(new Date());
    });
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, []);

  return (
    <AdminLayout title="Dashboard">
      {lastUpdated && (
        <p className="text-xs text-muted-foreground mb-3">
          Last updated: {lastUpdated.toLocaleTimeString()} · auto-refreshes every 30s
        </p>
      )}
      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : data ? (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            <StatCard title="Total Users" value={data.users.total} />
            <StatCard title="New Today" value={data.users.today} sub="users" />
            <StatCard title="Active This Week" value={data.users.activeThisWeek} sub="users" />
            <StatCard title="Total Bookings" value={data.bookings.total} />
            <StatCard title="Total Messages" value={data.messages.total} />
            <StatCard title="Messages Today" value={data.messages.today} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Bookings by Status</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-4">
                {Object.entries(data.bookings.byStatus).map(([status, count]) => (
                  <div key={status} className="flex flex-col items-center gap-1 min-w-[80px]">
                    <span className="text-2xl font-bold">{count}</span>
                    <span className="text-xs text-muted-foreground capitalize">{status.replace(/_/g, " ")}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <p className="text-muted-foreground">Failed to load dashboard data.</p>
      )}
    </AdminLayout>
  );
}
