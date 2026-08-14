"use client";

export const dynamic = "force-dynamic";

import { AdminLayout } from "@/components/AdminLayout";
import { AiKnowledgeSection } from "@/components/dashboard/AiKnowledgeSection";

export default function InfraPage() {
  return (
    <AdminLayout title="Infra">
      <p className="text-xs text-muted-foreground mb-4">
        Health and configuration of the AI &amp; knowledge layer. Graph and RAG auto-refresh; AI
        Model is manual-ping only.
      </p>
      <AiKnowledgeSection />
    </AdminLayout>
  );
}
