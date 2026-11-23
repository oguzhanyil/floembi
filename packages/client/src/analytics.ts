import type { FieldRef, FilterRef } from "./index";
export interface AnalyticsMetric { id: string; label: string; measure: string; unit: string; grain: string; company: FieldRef; filters?: FilterRef[]; tolerance?: number }
export interface AnalyticsRule { id: string; metricId: string; label: string; operator: "gt" | "ge" | "lt" | "le"; threshold: number; severity: "info" | "warning" | "critical" }
export interface AnalyticsConfig { protocol?: "floem-metric/v1"; dataTime?: string | null; metrics: AnalyticsMetric[]; rules: AnalyticsRule[] }
export interface MetricEvidence { protocol: string; metricId: string; metricVersion: string; snapshot: string; contextHash: string; dataTime: string | null; value: number | null }
export interface MetricReceipt extends MetricEvidence {
  datasetVersion: string; evaluatedAt: string; dataTimeStatus: "declared" | "unknown";
  context: { company: string | number | boolean; companyField: FieldRef; filters: FilterRef[]; unit: string; grain: string };
  alerts: (AnalyticsRule & { status: "triggered" | "clear" | "unknown" })[];
  comparison: { status: "not_provided" | "context_mismatch" | "unverified" | "match" | "value_mismatch"; reasons: string[] };
}
