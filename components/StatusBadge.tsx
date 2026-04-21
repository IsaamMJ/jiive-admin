import { Badge } from "@/components/ui/badge";

const colorMap: Record<string, string> = {
  confirmed: "bg-green-500/20 text-green-400 border-green-500/30",
  active: "bg-green-500/20 text-green-400 border-green-500/30",
  completed: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  pending_payment: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  pending: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  cancelled: "bg-red-500/20 text-red-400 border-red-500/30",
  failed: "bg-red-500/20 text-red-400 border-red-500/30",
  inactive: "bg-slate-500/20 text-slate-400 border-slate-500/30",
  normal: "bg-green-500/20 text-green-400 border-green-500/30",
  elevated: "bg-orange-500/20 text-orange-400 border-orange-500/30",
};

export function StatusBadge({ status }: { status: string }) {
  const cls = colorMap[status] ?? "bg-slate-500/20 text-slate-400 border-slate-500/30";
  return (
    <Badge variant="outline" className={`capitalize ${cls}`}>
      {status.replace(/_/g, " ")}
    </Badge>
  );
}
