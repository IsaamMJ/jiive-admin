"use client";

export const dynamic = "force-dynamic";

import { useRouter, useSearchParams } from "next/navigation";
import { AdminLayout } from "@/components/AdminLayout";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AllBookingsView } from "./components/AllBookingsView";
import { DayGroupedView } from "./components/DayGroupedView";

type View = "day" | "all";

export default function BookingsPage() {
  const router = useRouter();
  const params = useSearchParams();
  const view: View = params.get("view") === "all" ? "all" : "day";

  const setView = (v: View) => {
    const next = new URLSearchParams(params.toString());
    next.set("view", v);
    router.replace(`/bookings?${next.toString()}`);
  };

  return (
    <AdminLayout title="Bookings">
      <div className="flex flex-col gap-4">
        <Tabs value={view} onValueChange={(v) => setView(v as View)}>
          <TabsList>
            <TabsTrigger value="day">By day</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>
        {view === "day" ? <DayGroupedView /> : <AllBookingsView />}
      </div>
    </AdminLayout>
  );
}
