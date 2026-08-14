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
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import api from "@/lib/api";
import { cn } from "@/lib/utils";
import { checkPhone, type PhoneCheck } from "@/app/stuck-bookings/types";

// The three things a "clear history" can remove. The account, bookings, results
// and credits are never touched — this only resets the chat/AI side.
const CLEAR_SCOPES = [
  { key: "conversations", label: "Conversations", hint: "The WhatsApp chat history." },
  { key: "memories", label: "Memories", hint: "What the AI has learned about them." },
  { key: "flowStates", label: "Flow states", hint: "Where the bot is mid-conversation — resets it to a fresh start." },
] as const;
type ClearScopeKey = (typeof CLEAR_SCOPES)[number]["key"];

// The endpoint honors per-scope flags now (verified live: supported keys are
// confirm / conversations / memories / flowStates, and an unknown key 400s), so
// selecting a subset is safe. Body sends only the ticked scopes; omitting all
// would clear everything, but the UI always sends the three explicitly.
const SCOPED_CLEAR_SUPPORTED = true;

// Full purge (right-to-erasure) — a different, heavier action than Clear History.
// Live: DELETE /users/:phone/purge honors confirm:true (400 without / on unknown
// keys), erases PII and retains the legal stub (verified). See
// docs/handoff-backend-user-purge.md.
const PURGE_SUPPORTED = true;

// What a purge does, spelled out for the confirm step. Deliberately erases PII but
// KEEPS the two things law requires: a de-identified stub of completed paid orders
// (financial/tax retention) and the phone-hash opt-out (so a purged unsubscriber
// can't be messaged again).
const PURGE_ERASES = [
  "Name & phone number",
  "All conversations",
  "AI memories",
  "Result values & report content",
  "Saved addresses",
  "Family members",
  "Credit balance",
  "Incomplete bookings",
];
const PURGE_KEEPS = [
  "An anonymised stub of completed paid orders (amount + date, no PII) — tax law",
  "The phone-hash opt-out flag — so they stay unsubscribed",
];

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

// testChat (POST /chat) accepts two different shapes of "phone", and conflating
// them is exactly how a real customer gets a second account:
//   - synthetic test ids (test_*, eval_*) — verified live in
//     admin.controller.ts:1538 (`isSynthetic`), passed through unchanged
//   - real Indian mobiles — admin.controller.ts:1539 only checks shape
//     (`/^\d{10,15}$/`), it does NOT add a missing country code. That normalize
//     step lives in lumi-agent.service.ts → phone-utils.ts normalizePhone(),
//     which also never adds `91`. WhatsApp always delivers `91…`, so a number
//     typed without it becomes a SECOND `User` row (upsert on whatsappPhone,
//     lumi-agent.service.ts:2184-2192) that the real conversation never merges
//     into — same root cause we already fixed on the orphan-adopt form.
// So: synthetic ids pass straight through, phone-shaped input is resolved to
// the canonical 91-form with checkPhone() (same helper, same house rule as
// stuck-bookings/OrphanReports.tsx), and anything that's neither is refused
// client-side rather than letting the backend's shape-only check wave it through.
const TEST_CHAT_SYNTHETIC_RE = /^(test_|eval_)/;

type ChatPhoneStatus =
  | { kind: "empty" }
  | { kind: "synthetic" }
  | { kind: "phone"; check: PhoneCheck };

function classifyChatPhone(raw: string): ChatPhoneStatus {
  const trimmed = raw.trim();
  if (!trimmed) return { kind: "empty" };
  if (TEST_CHAT_SYNTHETIC_RE.test(trimmed)) return { kind: "synthetic" };
  return { kind: "phone", check: checkPhone(trimmed) };
}

export default function DebugPage() {
  const [env, setEnv] = useState<EnvCheck | null>(null);
  const [loading, setLoading] = useState(true);
  const [phone, setPhone] = useState("");
  const [clearResult, setClearResult] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [scopes, setScopes] = useState<Record<ClearScopeKey, boolean>>({
    conversations: true, memories: true, flowStates: true,
  });
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  // Purge — separate target + a type-the-number-to-confirm gate.
  const [purgePhone, setPurgePhone] = useState("");
  const [purgeConfirmText, setPurgeConfirmText] = useState("");
  const [purgeConfirmOpen, setPurgeConfirmOpen] = useState(false);
  const [purging, setPurging] = useState(false);
  const [purgeResult, setPurgeResult] = useState<string | null>(null);
  const [chatPhone, setChatPhone] = useState("");
  const [chatMsg, setChatMsg] = useState("");
  const [chatResult, setChatResult] = useState<string | null>(null);
  const [chatting, setChatting] = useState(false);

  useEffect(() => {
    api.get("/env-check").then((r) => { setEnv(r.data); setLoading(false); });
  }, []);

  // Which scopes are effectively selected. Until the backend honors selection,
  // it's always all three (the checkboxes are locked on).
  const activeScopes = SCOPED_CLEAR_SUPPORTED
    ? CLEAR_SCOPES.filter((s) => scopes[s.key])
    : [...CLEAR_SCOPES];

  const openClearConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone.trim()) return;
    if (activeScopes.length === 0) {
      toast.error("Pick at least one thing to clear.");
      return;
    }
    setClearConfirmOpen(true);
  };

  const doClearHistory = async () => {
    setClearConfirmOpen(false);
    setClearing(true);
    setClearResult(null);
    try {
      // `confirm: true` is required by the endpoint for destructive ops. Scope
      // flags are sent only when the backend honors them — otherwise it clears
      // all three regardless, and sending them would imply a selection it ignores.
      const body: Record<string, unknown> = { confirm: true };
      if (SCOPED_CLEAR_SUPPORTED) for (const s of CLEAR_SCOPES) body[s.key] = scopes[s.key];

      const { data } = await api.delete(`/users/${phone}/clear-history`, { data: body });
      if (data.success === false) {
        const msg = "Error: " + (data.error ?? "clear failed");
        setClearResult(msg);
        toast.error(msg);
        return;
      }
      const c = data.cleared ?? {};
      const msg = `Cleared: ${c.conversations ?? 0} conversations, ${c.memories ?? 0} memories, ${c.flowStates ?? 0} flow states`;
      setClearResult(msg);
      toast.success(msg);
    } catch (err: unknown) {
      const msg = "Error: " + ((err as { response?: { data?: { error?: string; message?: string } } })?.response?.data?.error ?? (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? "Unknown error");
      setClearResult(msg);
      toast.error(msg);
    } finally {
      setClearing(false);
    }
  };

  // Typing the exact phone number into the confirm box is what arms the button —
  // a purge is irreversible, so it can't be a single fat-fingered click.
  const purgeArmed =
    PURGE_SUPPORTED &&
    purgePhone.trim().length > 0 &&
    purgeConfirmText.trim() === purgePhone.trim();

  const doPurge = async () => {
    setPurgeConfirmOpen(false);
    setPurging(true);
    setPurgeResult(null);
    try {
      const { data } = await api.delete(`/users/${purgePhone.trim()}/purge`, {
        data: { confirm: true },
      });
      if (data.success === false) {
        const msg = "Error: " + (data.error ?? "purge failed");
        setPurgeResult(msg);
        toast.error(msg);
        return;
      }
      const msg = `Purged ${purgePhone.trim()} — PII erased, legal stub retained.`;
      setPurgeResult(msg);
      toast.success(msg);
      setPurgePhone("");
      setPurgeConfirmText("");
    } catch (err: unknown) {
      const r = (err as { response?: { data?: { error?: string; message?: string } } })?.response?.data;
      const msg = "Error: " + (r?.error ?? r?.message ?? "Unknown error");
      setPurgeResult(msg);
      toast.error(msg);
    } finally {
      setPurging(false);
    }
  };

  const chatPhoneStatus = classifyChatPhone(chatPhone);
  // Refuse anything that resolves to neither a synthetic test id nor a valid
  // Indian mobile — an unresolvable phone-shaped string is the exact input
  // that would otherwise reach the backend's shape-only check and get waved
  // through into a duplicate account.
  const chatBlocked = chatPhoneStatus.kind === "phone" && !chatPhoneStatus.check.ok;

  const handleTestChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (chatPhoneStatus.kind === "empty") return;
    if (chatBlocked) {
      toast.error(
        chatPhoneStatus.kind === "phone" ? chatPhoneStatus.check.problem ?? "Invalid phone." : "Invalid phone."
      );
      return;
    }
    const sendPhone =
      chatPhoneStatus.kind === "phone" ? chatPhoneStatus.check.canonical : chatPhone.trim();
    setChatting(true);
    setChatResult(null);
    try {
      const { data } = await api.post("/chat", { phone: sendPhone, message: chatMsg });
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
              <form onSubmit={openClearConfirm} className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="clear-phone">Phone number</Label>
                  <Input id="clear-phone" placeholder="919876543210" value={phone} onChange={(e) => setPhone(e.target.value)} required />
                </div>

                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">What to clear</Label>
                    {!SCOPED_CLEAR_SUPPORTED && (
                      <span className="text-[10px] text-muted-foreground">Individual selection unlocks once the backend supports it</span>
                    )}
                  </div>
                  {CLEAR_SCOPES.map((s) => {
                    const checked = SCOPED_CLEAR_SUPPORTED ? scopes[s.key] : true;
                    return (
                      <label
                        key={s.key}
                        className={cn(
                          "flex items-start gap-2.5 rounded-md border border-border px-3 py-2",
                          SCOPED_CLEAR_SUPPORTED ? "cursor-pointer hover:bg-accent" : "opacity-70"
                        )}
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5 h-4 w-4 accent-destructive"
                          checked={checked}
                          disabled={!SCOPED_CLEAR_SUPPORTED}
                          onChange={(e) => setScopes((p) => ({ ...p, [s.key]: e.target.checked }))}
                        />
                        <span className="flex flex-col">
                          <span className="text-sm font-medium leading-none">{s.label}</span>
                          <span className="mt-1 text-xs text-muted-foreground">{s.hint}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>

                <Button type="submit" variant="destructive" disabled={clearing}>
                  {clearing ? "Clearing…" : "Clear History"}
                </Button>
                {clearResult && <p className="text-xs text-muted-foreground">{clearResult}</p>}
              </form>
            </CardContent>
          </Card>

          <Card className="border-destructive/40">
            <CardHeader>
              <CardTitle className="text-sm font-medium text-destructive">Purge User (Right to Erasure)</CardTitle>
              <p className="text-xs text-muted-foreground">
                Permanently erases a person&apos;s data — far more than Clear History. Use only for a
                genuine deletion request. Irreversible.
              </p>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-md border border-destructive/20 bg-destructive/5 p-2.5">
                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-destructive">Erased</p>
                    <ul className="space-y-0.5 text-[11px] text-muted-foreground">
                      {PURGE_ERASES.map((x) => <li key={x}>• {x}</li>)}
                    </ul>
                  </div>
                  <div className="rounded-md border border-border p-2.5">
                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Kept (by law)</p>
                    <ul className="space-y-0.5 text-[11px] text-muted-foreground">
                      {PURGE_KEEPS.map((x) => <li key={x}>• {x}</li>)}
                    </ul>
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="purge-phone">Phone number</Label>
                  <Input
                    id="purge-phone"
                    placeholder="919876543210"
                    value={purgePhone}
                    onChange={(e) => setPurgePhone(e.target.value)}
                    disabled={!PURGE_SUPPORTED}
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="purge-confirm" className="text-xs">
                    Type the phone number again to confirm
                  </Label>
                  <Input
                    id="purge-confirm"
                    placeholder="919876543210"
                    value={purgeConfirmText}
                    onChange={(e) => setPurgeConfirmText(e.target.value)}
                    disabled={!PURGE_SUPPORTED || !purgePhone.trim()}
                    className="font-mono"
                  />
                </div>

                <Button
                  variant="destructive"
                  disabled={!purgeArmed || purging}
                  onClick={() => setPurgeConfirmOpen(true)}
                >
                  {purging ? "Purging…" : "Purge user permanently"}
                </Button>

                {!PURGE_SUPPORTED && (
                  <p className="text-[11px] text-amber-500">
                    Not available yet — needs the backend purge endpoint. Handed off; unlocks the moment it ships.
                  </p>
                )}
                {purgeResult && <p className="text-xs text-muted-foreground">{purgeResult}</p>}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Test Chat (Lumi)</CardTitle>
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Sends a real message into the Lumi pipeline and writes real conversation state
                (history, memories, funnel progress) onto whatever account the phone resolves to.
                Use a test_/eval_ id unless you specifically mean to message a real number.
              </p>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleTestChat} className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="chat-phone">Phone</Label>
                  <Input id="chat-phone" placeholder="test_000" value={chatPhone} onChange={(e) => setChatPhone(e.target.value)} required />
                  {/* Same rule as the orphan-adopt form: show exactly what will be sent,
                      never silently normalize. An unresolvable phone-shaped string is
                      refused rather than forwarded to the backend's shape-only check. */}
                  {chatPhoneStatus.kind === "synthetic" ? (
                    <p className="text-[11px] text-muted-foreground">
                      Synthetic test id — sent as typed, bypasses phone normalization.
                    </p>
                  ) : chatPhoneStatus.kind === "phone" ? chatPhoneStatus.check.ok ? (
                    <p className="text-[11px] text-muted-foreground">
                      Will send as{" "}
                      <span className="font-mono text-foreground">{chatPhoneStatus.check.canonical}</span>
                      {chatPhoneStatus.check.addedCountryCode && (
                        <span className="text-amber-600 dark:text-amber-400"> — we added the 91 for you</span>
                      )}
                      . Typing it without the 91 would create a second account this conversation
                      never merges into.
                    </p>
                  ) : (
                    <p className="text-[11px] text-destructive">{chatPhoneStatus.check.problem}</p>
                  ) : null}
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="chat-msg">Message</Label>
                  <Input id="chat-msg" placeholder="hi" value={chatMsg} onChange={(e) => setChatMsg(e.target.value)} required />
                </div>
                <Button type="submit" disabled={chatting || chatBlocked}>{chatting ? "Sending…" : "Send"}</Button>
                {chatResult && (
                  <pre className="text-xs bg-muted rounded p-2 overflow-auto max-h-48">{chatResult}</pre>
                )}
              </form>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Destructive-op confirmation. The endpoint requires confirm:true; this is
          also the human gate — it names the number and lists exactly what goes. */}
      <Dialog open={clearConfirmOpen} onOpenChange={setClearConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Clear history for {phone || "this number"}?</DialogTitle>
            <DialogDescription>
              Permanently removes the items below for this number. The account, bookings,
              results and credits are untouched. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
            {activeScopes.map((s) => (
              <div key={s.key} className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
                {s.label}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClearConfirmOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={doClearHistory} disabled={clearing}>
              {clearing ? "Clearing…" : "Clear history"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Purge — the last gate before an irreversible erasure. */}
      <Dialog open={purgeConfirmOpen} onOpenChange={setPurgeConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-destructive">Purge {purgePhone || "this user"} permanently?</DialogTitle>
            <DialogDescription>
              This erases their name, phone, chat, memories, results, addresses, family members and
              credits. A de-identified stub of completed paid orders and the opt-out flag are kept
              for legal reasons. <span className="font-medium text-foreground">This cannot be undone.</span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPurgeConfirmOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={doPurge} disabled={purging}>
              {purging ? "Purging…" : "Purge permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
