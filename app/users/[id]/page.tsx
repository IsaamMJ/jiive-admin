"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState, useCallback, useRef, Fragment } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { AdminLayout } from "@/components/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/StatusBadge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Sparkles, ExternalLink, Reply, RefreshCw, FileText, Image as ImageIcon, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import { InfoTip } from "@/components/InfoTip";
import { cn } from "@/lib/utils";

/**
 * The chat keeps arriving after the page loaded. Poll while the operator is
 * actually looking at the Conversations tab — not on every tab, and not while
 * the browser tab is in the background (that's a request every 10s for a screen
 * nobody is reading).
 */
const CONVO_POLL_MS = 10000;

const LIVE_EXPLAINER =
  "This chat refreshes itself every 10 seconds while you're on this tab, so new WhatsApp messages appear without you reloading. It pauses when you switch to another browser tab and catches up the moment you come back.";

interface CreditTx {
  id: string;
  type: string;
  amount: number;
  credits: number;
  description: string;
  balanceAfter: number;
  razorpayPaymentId: string | null;
  expiresAt: string | null;
  createdAt: string;
}

const TX_PAGE_SIZE = 20;

const TX_TYPE_COLOR: Record<string, string> = {
  purchase: "bg-green-500/20 text-green-400 border-green-500/30",
  manual_grant: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  usage: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  expiry: "bg-red-500/20 text-red-400 border-red-500/30",
};

/** An option the bot offered on an interactive message. `title` is what the customer saw. */
interface ConvButton {
  id: string;
  title: string;
}

/**
 * A file the customer sent (a lab report PDF, a photo). WhatsApp keeps media ~30
 * days, so `mediaId` is a live handle, not permanent storage — older uploads 404.
 */
interface ConvMedia {
  mediaId: string;
  filename?: string | null;
  mimeType?: string | null;
  caption?: string | null;
}

/**
 * An attachment bubble for a media message. Shows the file up front (icon +
 * name); clicking fetches it through the axios client so the admin bearer token
 * is attached — a plain <a href> would hit the media endpoint unauthenticated and
 * 401, and this is health data.
 *
 * The fetch is deliberately tolerant: the backend media endpoint is rolling out,
 * and WhatsApp only retains media ~30 days, so a miss is EXPECTED, not a crash.
 * A failure says so plainly instead of doing nothing.
 */
function MessageMedia({ media, tone }: { media: ConvMedia; tone: "light" | "dark" }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const isImage = (media.mimeType ?? "").startsWith("image/");
  const label = media.filename?.trim() || (isImage ? "Photo" : "Document");

  async function open() {
    if (busy) return;
    setBusy(true);
    setFailed(null);
    try {
      const r = await api.get(`/media/${encodeURIComponent(media.mediaId)}`, { responseType: "blob" });
      const url = URL.createObjectURL(r.data as Blob);
      // Open in a new tab; the browser renders PDFs/images inline, downloads the rest.
      window.open(url, "_blank", "noopener,noreferrer");
      // Give the tab a moment to grab the blob before we release it.
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      setFailed(
        status === 404
          ? "File is no longer available (WhatsApp keeps uploads ~30 days)."
          : status === 501 || status === 405
            ? "File viewing isn't switched on yet."
            : "Couldn't load this file."
      );
    } finally {
      setBusy(false);
    }
  }

  const frame =
    tone === "light"
      ? "border-primary-foreground/25 bg-primary-foreground/10 hover:bg-primary-foreground/20"
      : "border-border bg-background/60 hover:bg-background";

  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={open}
        disabled={busy}
        className={cn(
          "flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors",
          frame
        )}
      >
        {busy ? (
          <Loader2 size={16} className="shrink-0 animate-spin opacity-70" />
        ) : isImage ? (
          <ImageIcon size={16} className="shrink-0 opacity-70" />
        ) : (
          <FileText size={16} className="shrink-0 opacity-70" />
        )}
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">{label}</span>
          <span className="text-[11px] opacity-60">
            {busy ? "Opening…" : "Tap to open"}
          </span>
        </span>
        <Download size={14} className="ml-auto shrink-0 opacity-50" />
      </button>
      {media.caption?.trim() && <p className="mt-1 text-sm">{media.caption}</p>}
      {failed && <p className="mt-1 text-[11px] text-red-400">{failed}</p>}
    </div>
  );
}

/**
 * The WhatsApp-style option rows shown UNDER a bot message that offered buttons —
 * a reply-arrow + the label the customer saw, exactly as WhatsApp presents them.
 * Rendered only when the backend supplies the button set.
 */
function MessageButtons({ buttons }: { buttons: ConvButton[] }) {
  if (buttons.length === 0) return null;
  return (
    <div className="mt-2 flex flex-col border-t border-primary-foreground/15 pt-1">
      {buttons.map((b) => (
        <div
          key={b.id}
          className="flex items-center gap-2 border-t border-primary-foreground/10 py-1.5 text-sm text-sky-300 first:border-t-0"
        >
          <Reply size={14} className="shrink-0 -scale-x-100" />
          <span>{b.title}</span>
        </div>
      ))}
    </div>
  );
}

interface UserDetail {
  user: {
    id: string;
    whatsappPhone: string;
    name: string;
    dob: string | null;
    gender: string | null;
    email: string | null;
    profileComplete: boolean;
    status: string;
    createdAt: string;
    lastWhatsappActivity: string;
    creditBalance: { balance: number; updatedAt: string } | null;
  };
  conversations: (
    // `displayLabel` is the human label the customer actually saw/tapped for an
    // interactive button ("🧬 Know my Bio-Age"); `content` is the raw payload id
    // ("disc_know_bioage"). The backend resolves it; we prefer it for display.
    //
    // `buttons` are the options the BOT offered on an outbound interactive message
    // (id + the title the customer saw). Rendered as WhatsApp-style option rows
    // under the message. Present only once the backend stores the button set —
    // see docs/handoff-backend-conversation-buttons.md. Absent = nothing extra.
    | { type?: "chat"; direction: string; content: string; displayLabel?: string | null; messageType?: string; media?: ConvMedia | null; buttons?: ConvButton[] | null; createdAt: string }
    | { type: "template"; direction: "outbound"; content: string; displayLabel?: string | null; templateName: string; status: string; media?: ConvMedia | null; buttons?: ConvButton[] | null; createdAt: string }
  )[];
  bookings: {
    id: string; patientName: string; testType: string; appointmentDate: string;
    appointmentTime: string; status: string; amount: number; address: { city: string; pincode: number };
  }[];
  memories: { memoryType: string; content: string; relevanceScore: string; createdAt: string }[];
  results: {
    id: string; testType: string; calculatedAge: string; chronologicalAge: string;
    ageDelta: string; status: string; createdAt: string;
    retestReminderOptIn: boolean; retestReminderSentAt: string | null;
    /** Full shareable report link (latest non-expired token), or null if none. */
    reportUrl?: string | null;
    // WHO this result is for. One account books for several people, so a result
    // is not necessarily the account holder's. `patientName` is the test subject;
    // `relationship` is how they relate to the account holder (FamilyMember, id-
    // linked — not a name match). "self" = the account holder; null = an uploaded
    // report with no booking yet (shows the account-holder name, no relationship).
    patientName?: string | null;
    relationship?: string | null;
    /** FamilyMember id — lets "Ask AI" deep-link to THIS person's context. */
    patientId?: string | null;
  }[];
}

/**
 * "Who is this result for", rendered for the Patient column.
 *
 * The subject's name is the safety-critical bit — it's what stops a result being
 * read as the wrong person's. The relationship is shown only when it adds
 * something: "self" is dropped (it just repeats the account holder in the page
 * title), and null (uploaded reports not yet linked to a family member) shows the
 * name alone. So a family booking reads "Nisha Fathima · Mother"; the account
 * holder's own result reads just "Mohamed Isaam".
 *
 * `accountHolder` is the fallback for pre-deploy rows / uploaded reports that
 * carry no patientName yet — better the account name than a bare dash.
 */
function PatientCell({
  name, relationship, accountHolder,
}: { name?: string | null; relationship?: string | null; accountHolder: string }) {
  const subject = name?.trim() || accountHolder;
  const rel = relationship?.trim();
  const showRel = rel && rel.toLowerCase() !== "self";
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="font-medium">{subject}</span>
      {showRel && (
        <span className="text-xs capitalize text-muted-foreground">· {rel}</span>
      )}
    </span>
  );
}

type ResultRow = UserDetail["results"][number];

/**
 * Group a person's results under one heading. One account is a household, so
 * results belong to PEOPLE — a customer with three tests is one patient, not
 * three rows to scan independently. Grouping keys on the FamilyMember id when we
 * have it (stable), else the name, else a single account bucket for legacy rows
 * that carry no subject yet.
 */
function groupResultsByPatient(results: ResultRow[]) {
  const groups = new Map<string, { key: string; name?: string | null; relationship?: string | null; patientId?: string | null; rows: ResultRow[] }>();
  for (const r of results) {
    const key = r.patientId || r.patientName || "__account__";
    let g = groups.get(key);
    if (!g) {
      g = { key, name: r.patientName, relationship: r.relationship, patientId: r.patientId, rows: [] };
      groups.set(key, g);
    }
    g.rows.push(r);
  }
  return [...groups.values()];
}

/**
 * Render WhatsApp inline formatting the way WhatsApp itself does, so the admin
 * conversation reads like the real chat instead of showing raw markers:
 *   *bold*   _italic_   ~strikethrough~   ```monospace```
 * Anything that isn't a complete, non-empty pair is left as literal text.
 */
function formatWhatsApp(text: string, keyBase: string) {
  // One token = a whole *…* / _…_ / ~…~ / ```…``` run. Split keeps the delimiters.
  const TOKEN = /(```[^`]+```|\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g;
  return text.split(TOKEN).map((part, i) => {
    const key = `${keyBase}-${i}`;
    if (/^```[^`]+```$/.test(part))
      return <code key={key} className="rounded bg-black/20 px-1 font-mono text-[0.9em] dark:bg-white/15">{part.slice(3, -3)}</code>;
    if (/^\*[^*\n]+\*$/.test(part)) return <strong key={key}>{part.slice(1, -1)}</strong>;
    if (/^_[^_\n]+_$/.test(part)) return <em key={key}>{part.slice(1, -1)}</em>;
    if (/^~[^~\n]+~$/.test(part)) return <del key={key}>{part.slice(1, -1)}</del>;
    return <span key={key}>{part}</span>;
  });
}

/**
 * Render a message body the way WhatsApp shows it: inline formatting (bold/italic/
 * strike/mono) applied, and any URL turned into a clickable link that opens in a
 * new tab — so an operator taps to open a report instead of copy-pasting it.
 */
function MessageBody({ content }: { content: string }) {
  // Links first (no formatting inside a URL); format the text between links.
  const parts = content.split(/(https?:\/\/[^\s]+)/g);
  return (
    <p className="whitespace-pre-wrap break-words">
      {parts.map((part, i) => {
        if (!/^https?:\/\//.test(part)) return <span key={i}>{formatWhatsApp(part, String(i))}</span>;
        const trailing = part.match(/[)\].,;:'"]+$/)?.[0] ?? "";
        const href = trailing ? part.slice(0, -trailing.length) : part;
        return (
          <span key={i}>
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 break-all underline underline-offset-2 hover:opacity-80"
            >
              {href}
              <ExternalLink size={12} className="shrink-0" />
            </a>
            {trailing}
          </span>
        );
      })}
    </p>
  );
}

export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const [activeTab, setActiveTab] = useState("profile");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const convoScrollRef = useRef<HTMLDivElement | null>(null);
  /** Was the operator pinned to the bottom before this refresh? Decided pre-render. */
  const wasAtBottomRef = useRef(true);
  const convoCountRef = useRef(0);

  const [txs, setTxs] = useState<CreditTx[]>([]);
  const [txTotal, setTxTotal] = useState(0);
  const [txOffset, setTxOffset] = useState(0);
  const [txLoading, setTxLoading] = useState(false);

  const [grantOpen, setGrantOpen] = useState(false);
  const [grantForm, setGrantForm] = useState({ credits: "", reason: "", notify: true });
  const [grantSubmitting, setGrantSubmitting] = useState(false);
  const [grantError, setGrantError] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const loadUser = useCallback(() => {
    api.get(`/users/${id}`).then((r) => { setData(r.data); setLoading(false); });
  }, [id]);

  /**
   * A silent re-fetch: no skeleton, no toast, and a failure leaves the messages
   * already on screen alone. A dropped poll is not worth blanking the chat — the
   * next tick fixes it, and the "updated HH:MM:SS" stamp shows if it went stale.
   */
  const refreshUser = useCallback(async () => {
    const el = convoScrollRef.current;
    wasAtBottomRef.current = el
      ? el.scrollHeight - el.scrollTop - el.clientHeight < 80
      : true;
    setRefreshing(true);
    try {
      const r = await api.get(`/users/${id}`);
      setData(r.data);
      setRefreshedAt(new Date());
    } catch {
      // Keep what's on screen; the next tick will try again.
    } finally {
      setRefreshing(false);
    }
  }, [id]);

  // Poll only while the Conversations tab is open AND the browser tab is visible.
  useEffect(() => {
    if (activeTab !== "conversations") return;

    const tick = () => {
      if (document.visibilityState === "visible") refreshUser();
    };
    const timer = setInterval(tick, CONVO_POLL_MS);

    // Coming back to the tab shouldn't mean waiting out the rest of the interval.
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshUser();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [activeTab, refreshUser]);

  const conversationCount = data?.conversations.length ?? 0;

  // New messages land at the bottom. Follow them only if the operator was already
  // there — yanking someone who scrolled up to read history is worse than stale.
  useEffect(() => {
    if (activeTab !== "conversations") return;
    const el = convoScrollRef.current;
    if (!el) return;
    const grew = conversationCount > convoCountRef.current;
    convoCountRef.current = conversationCount;
    if (grew && wasAtBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [activeTab, conversationCount]);

  const loadTxPage = useCallback((offset: number) => {
    setTxLoading(true);
    api.get(`/users/${id}/credit-transactions?limit=${TX_PAGE_SIZE}&offset=${offset}`).then((r) => {
      setTxs(r.data.transactions);
      setTxTotal(r.data.total);
      setTxOffset(offset);
      setTxLoading(false);
    });
  }, [id]);

  useEffect(() => {
    api.get(`/users/${id}`).then((r) => { setData(r.data); setLoading(false); });
    api.get(`/users/${id}/credit-transactions?limit=${TX_PAGE_SIZE}&offset=0`).then((r) => {
      setTxs(r.data.transactions);
      setTxTotal(r.data.total);
      setTxOffset(0);
    });
  }, [id]);

  const submitGrant = async () => {
    setGrantSubmitting(true);
    setGrantError("");
    const credits = parseInt(grantForm.credits, 10);
    if (!Number.isFinite(credits) || credits <= 0) {
      setGrantError("Credits must be > 0");
      setGrantSubmitting(false);
      return;
    }
    if (!grantForm.reason.trim()) {
      setGrantError("Reason required");
      setGrantSubmitting(false);
      return;
    }
    try {
      const r = await api.post(`/users/${id}/grant-credits`, {
        credits,
        reason: grantForm.reason.trim(),
        notify: grantForm.notify,
      });
      toast.success(`Granted ${credits} credits. New balance: ${r.data.newBalance}`);
      setConfirmOpen(false);
      setGrantOpen(false);
      setGrantForm({ credits: "", reason: "", notify: true });
      loadUser();
      loadTxPage(0);
    } catch (err: unknown) {
      setGrantError((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Grant failed");
    } finally {
      setGrantSubmitting(false);
    }
  };

  const txPage = Math.floor(txOffset / TX_PAGE_SIZE);
  const txTotalPages = Math.max(1, Math.ceil(txTotal / TX_PAGE_SIZE));

  if (loading) return (
    <AdminLayout title="User Detail">
      <div className="flex flex-col gap-4">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
      </div>
    </AdminLayout>
  );

  if (!data) return (
    <AdminLayout title="User Detail">
      <p className="text-muted-foreground">User not found.</p>
    </AdminLayout>
  );

  const { user, conversations, bookings, memories, results } = data;

  return (
    <AdminLayout title={user.name ?? user.whatsappPhone}>
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col gap-4">
        <TabsList className="w-fit">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="conversations">Conversations ({conversations.length})</TabsTrigger>
          <TabsTrigger value="bookings">Bookings ({bookings.length})</TabsTrigger>
          <TabsTrigger value="results">Results ({results.length})</TabsTrigger>
          <TabsTrigger value="memories">Memories ({memories.length})</TabsTrigger>
          <TabsTrigger value="credits">Credits ({txTotal})</TabsTrigger>
        </TabsList>

        {/* Profile */}
        <TabsContent value="profile">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <CardTitle className="text-sm font-medium">Profile</CardTitle>
              <Link href={`/playground?userId=${id}`}>
                <Button size="sm" variant="outline" className="gap-1.5">
                  <Sparkles size={14} />
                  Ask AI about this patient
                </Button>
              </Link>
            </CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              <div><p className="text-muted-foreground">Phone</p><p className="font-mono">{user.whatsappPhone}</p></div>
              <div><p className="text-muted-foreground">Name</p><p>{user.name ?? "—"}</p></div>
              <div><p className="text-muted-foreground">Email</p><p>{user.email ?? "—"}</p></div>
              <div><p className="text-muted-foreground">Gender</p><p className="capitalize">{user.gender ?? "—"}</p></div>
              <div><p className="text-muted-foreground">Date of Birth</p><p>{user.dob ? new Date(user.dob).toLocaleDateString() : "—"}</p></div>
              <div><p className="text-muted-foreground">Status</p><div className="mt-1"><StatusBadge status={user.status} /></div></div>
              <div><p className="text-muted-foreground">Profile Complete</p>
                <Badge variant={user.profileComplete ? "default" : "secondary"} className="mt-1">
                  {user.profileComplete ? "Yes" : "No"}
                </Badge>
              </div>
              <div><p className="text-muted-foreground">Credit Balance</p><p className="text-xl font-bold">{user.creditBalance?.balance ?? 0}</p></div>
              <div><p className="text-muted-foreground">Joined</p><p>{new Date(user.createdAt).toLocaleDateString()}</p></div>
              <div><p className="text-muted-foreground">Last Active</p><p>{user.lastWhatsappActivity ? new Date(user.lastWhatsappActivity).toLocaleDateString() : "—"}</p></div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Conversations */}
        <TabsContent value="conversations">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              <span>
                Live
                {refreshedAt && ` · updated ${refreshedAt.toLocaleTimeString()}`}
              </span>
              <InfoTip label={LIVE_EXPLAINER} />
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={refreshUser}
              disabled={refreshing}
            >
              <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
              {refreshing ? "Refreshing…" : "Refresh"}
            </Button>
          </div>
          <div ref={convoScrollRef} className="flex flex-col gap-2 max-h-[600px] overflow-y-auto pr-1">
            {conversations.length === 0 ? (
              <p className="text-muted-foreground text-sm">No conversations.</p>
            ) : conversations.map((msg, i) => {
              if (msg.type === "template") {
                const failed = msg.status?.toLowerCase() === "failed";
                return (
                  <div key={i} className="flex justify-end">
                    <div className="max-w-[75%] rounded-2xl rounded-br-sm bg-primary text-primary-foreground px-4 py-2 text-sm">
                      <div className="flex items-center gap-1.5 mb-1">
                        <Badge
                          variant="outline"
                          className={`px-1.5 py-0 text-[10px] ${failed ? "border-red-500/40 bg-red-500/20 text-red-300" : "border-primary-foreground/30 bg-primary-foreground/15 text-primary-foreground/90"}`}
                        >
                          Template
                        </Badge>
                        <span className="text-[10px] text-primary-foreground/70">{msg.templateName}</span>
                        {failed && <span className="text-[10px] text-red-300">· failed</span>}
                      </div>
                      {msg.media ? (
                        <MessageMedia media={msg.media} tone="light" />
                      ) : (
                        <MessageBody content={msg.displayLabel ?? msg.content} />
                      )}
                      <p className="text-xs mt-1 text-primary-foreground/60">
                        {new Date(msg.createdAt).toLocaleString()}
                      </p>
                      {msg.buttons && <MessageButtons buttons={msg.buttons} />}
                    </div>
                  </div>
                );
              }
              return (
                <div key={i} className={`flex ${msg.direction === "outbound" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm ${msg.direction === "outbound" ? "bg-primary text-primary-foreground rounded-br-sm" : "bg-muted rounded-bl-sm"}`}>
                    {msg.media ? (
                      <MessageMedia media={msg.media} tone={msg.direction === "outbound" ? "light" : "dark"} />
                    ) : (
                      <MessageBody content={msg.displayLabel ?? msg.content} />
                    )}
                    <p className={`text-xs mt-1 ${msg.direction === "outbound" ? "text-primary-foreground/60" : "text-muted-foreground"}`}>
                      {new Date(msg.createdAt).toLocaleString()}
                    </p>
                    {msg.buttons && <MessageButtons buttons={msg.buttons} />}
                  </div>
                </div>
              );
            })}
          </div>
        </TabsContent>

        {/* Bookings */}
        <TabsContent value="bookings">
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Patient</TableHead>
                  <TableHead>Test</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>City</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bookings.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">No bookings</TableCell></TableRow>
                ) : bookings.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-medium">{b.patientName}</TableCell>
                    <TableCell className="capitalize">{b.testType.replace(/_/g, " ")}</TableCell>
                    <TableCell className="text-xs">{new Date(b.appointmentDate).toLocaleDateString()}</TableCell>
                    <TableCell className="text-xs">{b.appointmentTime}</TableCell>
                    <TableCell><StatusBadge status={b.status} /></TableCell>
                    <TableCell className="text-right">₹{(b.amount / 100).toLocaleString()}</TableCell>
                    <TableCell className="text-xs">{b.address?.city ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* Results */}
        <TabsContent value="results">
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Patient</TableHead>
                  <TableHead>Test</TableHead>
                  <TableHead>Bio Age</TableHead>
                  <TableHead>Chrono Age</TableHead>
                  <TableHead>Delta</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Reminder</TableHead>
                  <TableHead className="text-right">Report</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.length === 0 ? (
                  <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-6">No results</TableCell></TableRow>
                ) : groupResultsByPatient(results).map((group) => (
                  <Fragment key={group.key}>
                    {/* One heading per person — carries who they are + one "Ask AI"
                        that loads THIS patient's whole history, never blended. */}
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableCell colSpan={8} className="py-2">
                        <PatientCell name={group.name} relationship={group.relationship} accountHolder={user.name ?? user.whatsappPhone} />
                      </TableCell>
                      <TableCell className="py-2 text-right">
                        {/* Renders only once the result carries a FamilyMember id;
                            until the backend exposes it, no dead button. */}
                        {group.patientId && (
                          <Link href={`/playground?patientId=${group.patientId}`}>
                            <Button variant="outline" size="sm" className="gap-1.5">
                              <Sparkles size={13} />
                              Ask AI
                            </Button>
                          </Link>
                        )}
                      </TableCell>
                    </TableRow>
                    {group.rows.map((r) => (
                      <TableRow key={r.id} className="cursor-pointer hover:bg-accent">
                        <TableCell />
                        <TableCell>
                          <Link href={`/results/${r.id}`} className="capitalize hover:underline text-primary">
                            {r.testType.replace(/_/g, " ")}
                          </Link>
                        </TableCell>
                        <TableCell>{r.calculatedAge ?? "—"}</TableCell>
                        <TableCell>{r.chronologicalAge ?? "—"}</TableCell>
                        <TableCell className={parseFloat(r.ageDelta) < 0 ? "text-green-400" : "text-red-400"}>{r.ageDelta ?? "—"}</TableCell>
                        <TableCell><StatusBadge status={r.status} /></TableCell>
                        <TableCell className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleDateString()}</TableCell>
                        <TableCell className="text-xs">
                          {r.retestReminderSentAt ? (
                            <span className="text-green-400">Sent {new Date(r.retestReminderSentAt).toLocaleDateString()}</span>
                          ) : r.retestReminderOptIn ? (
                            <span className="text-blue-400">Opted in</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          {r.reportUrl ? (
                            <a href={r.reportUrl} target="_blank" rel="noopener noreferrer" className="inline-flex">
                              <Button variant="outline" size="sm">
                                <ExternalLink size={13} className="mr-1.5" />
                                Open report
                              </Button>
                            </a>
                          ) : (
                            <span className="text-xs text-muted-foreground">No link</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* Memories */}
        <TabsContent value="memories">
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Content</TableHead>
                  <TableHead>Relevance</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {memories.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">No memories</TableCell></TableRow>
                ) : memories.map((m, i) => (
                  <TableRow key={i}>
                    <TableCell><Badge variant="outline" className="capitalize text-xs">{m.memoryType.replace(/_/g, " ")}</Badge></TableCell>
                    <TableCell className="text-sm max-w-xs">{m.content}</TableCell>
                    <TableCell>{(parseFloat(m.relevanceScore) * 100).toFixed(0)}%</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(m.createdAt).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* Credits */}
        <TabsContent value="credits">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="text-sm">
                <span className="text-muted-foreground">Current balance: </span>
                <span className="text-xl font-bold">{user.creditBalance?.balance ?? 0}</span>
              </div>
              <Button onClick={() => { setGrantForm({ credits: "", reason: "", notify: true }); setGrantError(""); setGrantOpen(true); }}>
                Grant credits
              </Button>
            </div>

            <div className="rounded-lg border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Credits</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Balance After</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {txLoading ? (
                    <TableRow><TableCell colSpan={6}><Skeleton className="h-8" /></TableCell></TableRow>
                  ) : txs.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No transactions</TableCell></TableRow>
                  ) : txs.map((t) => {
                    const cls = TX_TYPE_COLOR[t.type] ?? "bg-slate-500/20 text-slate-400 border-slate-500/30";
                    const signed = t.credits > 0 ? `+${t.credits}` : String(t.credits);
                    return (
                      <TableRow key={t.id}>
                        <TableCell><Badge variant="outline" className={`text-xs ${cls}`}>{t.type.replace(/_/g, " ")}</Badge></TableCell>
                        <TableCell className="text-sm">{t.description}</TableCell>
                        <TableCell className={`text-right font-medium ${t.credits > 0 ? "text-green-400" : "text-orange-400"}`}>{signed}</TableCell>
                        <TableCell className="text-right">₹{(t.amount / 100).toLocaleString()}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{t.balanceAfter}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{new Date(t.createdAt).toLocaleString()}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {txTotalPages > 1 && (
              <div className="flex items-center justify-between">
                <Button variant="outline" size="sm" disabled={txOffset === 0} onClick={() => loadTxPage(Math.max(0, txOffset - TX_PAGE_SIZE))}>
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground">Page {txPage + 1} of {txTotalPages}</span>
                <Button variant="outline" size="sm" disabled={txOffset + TX_PAGE_SIZE >= txTotal} onClick={() => loadTxPage(txOffset + TX_PAGE_SIZE)}>
                  Next
                </Button>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={grantOpen} onOpenChange={setGrantOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Grant credits to {user.name ?? user.whatsappPhone}</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => { e.preventDefault(); setConfirmOpen(true); }}
            className="flex flex-col gap-4 mt-2"
          >
            <div className="text-sm text-muted-foreground">
              Current balance: <span className="font-bold text-foreground">{user.creditBalance?.balance ?? 0}</span>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="credits">Credits to grant</Label>
              <Input id="credits" type="number" min={1} value={grantForm.credits}
                onChange={(e) => setGrantForm({ ...grantForm, credits: e.target.value })} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reason">Reason (logged in audit + sent to user)</Label>
              <Input id="reason" value={grantForm.reason}
                onChange={(e) => setGrantForm({ ...grantForm, reason: e.target.value })} required />
            </div>
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={grantForm.notify}
                onChange={(e) => setGrantForm({ ...grantForm, notify: e.target.checked })} />
              <span className="text-sm">Notify user via WhatsApp</span>
            </label>
            {grantError && <p className="text-sm text-destructive">{grantError}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setGrantOpen(false)}>Cancel</Button>
              <Button type="submit">Review</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm credit grant</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 mt-2 text-sm">
            <p>
              Grant <span className="font-bold">{grantForm.credits} credits</span> to{" "}
              <span className="font-bold">{user.name ?? user.whatsappPhone}</span>?
            </p>
            <p className="text-muted-foreground">Reason: {grantForm.reason}</p>
            <p className="text-muted-foreground">
              New balance will be {(user.creditBalance?.balance ?? 0) + (parseInt(grantForm.credits, 10) || 0)}.
              {grantForm.notify ? " User will be notified on WhatsApp." : " User will NOT be notified."}
            </p>
            <p className="text-destructive text-xs">This cannot be undone.</p>
            {grantError && <p className="text-sm text-destructive">{grantError}</p>}
            <div className="flex justify-end gap-2 mt-2">
              <Button variant="ghost" onClick={() => setConfirmOpen(false)}>Back</Button>
              <Button onClick={submitGrant} disabled={grantSubmitting}>
                {grantSubmitting ? "Granting…" : "Confirm grant"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
