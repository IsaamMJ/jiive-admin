"use client";

export const dynamic = "force-dynamic";

import { useState } from "react";
import { AdminLayout } from "@/components/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import api from "@/lib/api";

interface OrderResult {
  success: boolean;
  bookingId?: string;
  thyrocareOrderId?: string;
  thyrocareLeadId?: string;
  error?: string;
  details?: unknown;
  raw?: unknown;
}

export default function ThyrocarePage() {
  const [bookingId, setBookingId] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<OrderResult | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    try {
      const { data } = await api.post("/thyrocare/test-order", { bookingId });
      setResult(data);
    } catch (err: unknown) {
      const data = (err as { response?: { data?: OrderResult } })?.response?.data;
      setResult(data ?? { success: false, error: "Network error" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <AdminLayout title="Thyrocare Test Order">
      <div className="max-w-lg">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Trigger Test Order</CardTitle>
            <p className="text-xs text-muted-foreground">
              Manually trigger a real Thyrocare order for an existing booking. Bypasses the Razorpay flow.
            </p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="bookingId">Booking ID (UUID)</Label>
                <Input
                  id="bookingId"
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  value={bookingId}
                  onChange={(e) => setBookingId(e.target.value)}
                  required
                  className="font-mono text-sm"
                />
              </div>
              <Button type="submit" disabled={loading}>
                {loading ? "Submitting…" : "Place Test Order"}
              </Button>
            </form>

            {result && (
              <div className={`mt-4 rounded-lg p-4 text-sm ${result.success ? "bg-green-500/10 border border-green-500/20" : "bg-red-500/10 border border-red-500/20"}`}>
                {result.success ? (
                  <div className="flex flex-col gap-1">
                    <p className="font-semibold text-green-400">Order placed successfully</p>
                    <p className="text-muted-foreground">Thyrocare Order ID: <span className="font-mono">{result.thyrocareOrderId}</span></p>
                    <p className="text-muted-foreground">Lead ID: <span className="font-mono">{result.thyrocareLeadId}</span></p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    <p className="font-semibold text-red-400">Order failed</p>
                    <p className="text-muted-foreground">{result.error}</p>
                    {result.details != null && (
                      <pre className="text-xs bg-muted rounded p-2 overflow-auto max-h-48">
                        {JSON.stringify(result.details as object, null, 2)}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
