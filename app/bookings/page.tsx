"use client";

export const dynamic = "force-dynamic";

import { AdminLayout } from "@/components/AdminLayout";
import { AllBookingsView } from "./components/AllBookingsView";

export default function BookingsPage() {
  return (
    <AdminLayout title="Bookings">
      <AllBookingsView />
    </AdminLayout>
  );
}
