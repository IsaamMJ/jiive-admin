"use client";

export const dynamic = "force-dynamic";

import { useState } from "react";
import { AdminLayout } from "@/components/AdminLayout";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AllBookingsView } from "./components/AllBookingsView";
import { DayGroupedView } from "./components/DayGroupedView";

type View = "day" | "all";

export default function BookingsPage() {
  const [view, setView] = useState<View>("day");

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
