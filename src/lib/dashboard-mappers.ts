// Server-side mapping from DB rows to the client-safe dashboard view models.
// Import only from Server Components / server actions — this file pulls in the
// Drizzle schema for capability metadata.

import {
  CAPABILITY_META,
  categoryForCapability,
  type Signal,
  type TrackedEntity,
} from "@/server/db/schema";
import type { DashboardEntity, DashboardSignal } from "./dashboard-data";

export function toDashboardEntity(entity: TrackedEntity): DashboardEntity {
  return {
    id: entity.id,
    role: entity.role,
    brandName: entity.brandName ?? entity.domain,
    domain: entity.domain,
  };
}

export function toDashboardSignal(signal: Signal): DashboardSignal {
  return {
    id: signal.id,
    title: signal.title,
    severity: signal.severity,
    category: categoryForCapability(signal.capabilityKey),
    capabilityLabel: CAPABILITY_META[signal.capabilityKey].label,
    entityId: signal.subjectEntityId,
    sourceUrl: signal.evidence?.sourceUrl,
    lastSeenAt: signal.lastSeenAt.toISOString(),
  };
}
