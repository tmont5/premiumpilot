import { Badge } from "@/components/ui/badge";
import { STATUS_LABEL, STATUS_TONE } from "@/lib/status";
import type { PositionStatus } from "@/lib/types";

export function StatusBadge({ status }: { status: PositionStatus }) {
  return <Badge variant={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}
