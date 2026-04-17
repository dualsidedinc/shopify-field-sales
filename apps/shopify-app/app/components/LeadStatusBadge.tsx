import type { LeadStatus } from "@field-sales/database";

interface LeadStatusBadgeProps {
  status: LeadStatus;
}

type BadgeTone = "info" | "success" | "warning" | "critical" | "neutral";

const STATUS_CONFIG: Record<LeadStatus, { label: string; tone: BadgeTone }> = {
  NEW: { label: "New", tone: "info" },
  REVIEWED: { label: "Reviewed", tone: "warning" },
  APPROVED: { label: "Approved", tone: "success" },
  REJECTED: { label: "Rejected", tone: "critical" },
};

export function LeadStatusBadge({ status }: LeadStatusBadgeProps) {
  const config = STATUS_CONFIG[status] || { label: status, tone: "neutral" as BadgeTone };

  return <s-badge tone={config.tone}>{config.label}</s-badge>;
}
