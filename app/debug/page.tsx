"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { AdminLayout } from "@/components/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import api from "@/lib/api";

interface EnvCheck {
  hasOpenAI: boolean;
  hasLangfusePublic: boolean;
  hasLangfuseSecret: boolean;
  langfuseBaseUrl: string;
  langfusePublicPrefix: string;
  hasRedis: boolean;
  hasWhatsappSecret: boolean;
  hasAdminToken: boolean;
  thyrocare: {
    hasBaseUrl: boolean;
    baseUrl: string;
    hasUsername: boolean;
    hasPassword: boolean;
    hasPartnerId: boolean;
    partnerId: string;
    hasSkuId: boolean;
    skuId: string | null;
    hasRelayNumber: boolean;
  };
}

function EnvBool({ label, value }: { label: string; value: boolean | string | null }) {
  const isTrue = value === true || (typeof value === "string" && value.length > 0);
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
      <span className="text-sm">{label}</span>
      {typeof value === "string" && value ? (
        <span className="text-xs font-mono text-muted-foreground">{value}</span>
      ) : (
        <Badge variant="outline" className={isTrue ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-red-500/20 text-red-400 border-red-500/30"}>
          {isTrue ? "✓" : "✗"}
        </Badge>
      )}
    </div>
  );
}

export default function DebugPage() {
  const [env, setEnv] = useState<EnvCheck | null>(null);
  const [loading, setLoading] = useState(true);
  const [phone, setPhone] = useState("");
  const [clearResult, setClearResult] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [chatPhone, setChatPhone] = useState("");
  const [chatMsg, setChatMsg] = useState("");
  const [chatResult, setChatResult] = useState<string | null>(null);
  const [chatting, setChatting] = useState(false);

  useEffect(() => {
    api.get("/env-check").then((r) => { setEnv(r.data); setLoading(false); });
  }, []);

  const handleClearHistory = async (e: React.FormEvent) => {
    e.preventDefault();
    setClearing(true);
    setClearResult(null);
    try {
      const { data } = await api.delete(`/users/${phone}/clear-history`);
      const msg = `Cleared: ${data.cleared.conversations} conversations, ${data.cleared.memories} memories, ${data.cleared.flowStates} flow states`;
      setClearResult(msg);
      toast.success(msg);
    } catch (err: unknown) {
      const msg = "Error: " + ((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Unknown error");
      setClearResult(msg);
      toast.error(msg);
    } finally {
      setClearing(false);
    }
  };

  const handleTestChat = async (e: React.FormEvent) => {
    e.preventDefault();
    setChatting(true);
    setChatResult(null);
    try {
      const { data } = await api.post("/chat", { phone: chatPhone, message: chatMsg });
      setChatResult(JSON.stringify(data, null, 2));
    } catch (err: unknown) {
      setChatResult("Error: " + ((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Unknown error"));
    } finally {
      setChatting(false);
    }
  };

  return (
    <AdminLayout title="Debug">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {loading ? (
          <Skeleton className="h-96" />
        ) : env ? (
          <Card>
            <CardHeader><CardTitle className="text-sm font-medium">Environment Variables</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-0">
              <EnvBool label="OpenAI" value={env.hasOpenAI} />
              <EnvBool label="Langfuse Public" value={env.hasLangfusePublic} />
              <EnvBool label="Langfuse Secret" value={env.hasLangfuseSecret} />
              <EnvBool label="Langfuse Base URL" value={env.langfuseBaseUrl} />
              <EnvBool label="Langfuse Public Prefix" value={env.langfusePublicPrefix} />
              <EnvBool label="Redis" value={env.hasRedis} />
              <EnvBool label="WhatsApp Secret" value={env.hasWhatsappSecret} />
              <EnvBool label="Admin Token" value={env.hasAdminToken} />
              <div className="mt-3 pt-3 border-t border-border">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Thyrocare</p>
                <EnvBool label="Base URL" value={env.thyrocare.baseUrl} />
                <EnvBool label="Username" value={env.thyrocare.hasUsername} />
                <EnvBool label="Password" value={env.thyrocare.hasPassword} />
                <EnvBool label="Partner ID" value={env.thyrocare.partnerId} />
                <EnvBool label="SKU ID" value={env.thyrocare.skuId ?? false} />
                <EnvBool label="Relay Number" value={env.thyrocare.hasRelayNumber} />
              </div>
            </CardContent>
          </Card>
        ) : null}

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader><CardTitle className="text-sm font-medium">Clear User History</CardTitle></CardHeader>
            <CardContent>
              <form onSubmit={handleClearHistory} className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="clear-phone">Phone number</Label>
                  <Input id="clear-phone" placeholder="919876543210" value={phone} onChange={(e) => setPhone(e.target.value)} required />
                </div>
                <Button type="submit" variant="destructive" disabled={clearing}>
                  {clearing ? "Clearing…" : "Clear History"}
                </Button>
                {clearResult && <p className="text-xs text-muted-foreground">{clearResult}</p>}
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm font-medium">Test Chat (Lumi)</CardTitle></CardHeader>
            <CardContent>
              <form onSubmit={handleTestChat} className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="chat-phone">Phone</Label>
                  <Input id="chat-phone" placeholder="test_000" value={chatPhone} onChange={(e) => setChatPhone(e.target.value)} required />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="chat-msg">Message</Label>
                  <Input id="chat-msg" placeholder="hi" value={chatMsg} onChange={(e) => setChatMsg(e.target.value)} required />
                </div>
                <Button type="submit" disabled={chatting}>{chatting ? "Sending…" : "Send"}</Button>
                {chatResult && (
                  <pre className="text-xs bg-muted rounded p-2 overflow-auto max-h-48">{chatResult}</pre>
                )}
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </AdminLayout>
  );
}
