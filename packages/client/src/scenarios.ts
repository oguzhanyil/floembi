import type { FieldRef, FilterRef } from "./index";
export interface ScenarioParameter { id: string; label: string; measure: string; unit: string; minimum: number; maximum: number; step: number; defaultValue: number }
export interface ScenarioOutput { measure: string; label: string; unit: string }
export interface ScenarioDefinition { id: string; label: string; description?: string; company: FieldRef; filters?: FilterRef[]; parameters: ScenarioParameter[]; outputs: ScenarioOutput[]; proposalEnabled?: boolean; submitRoles?: ("admin" | "member" | "contributor" | "viewer")[] }
export interface ScenarioQuery { id: string; values?: Record<string, number>; snapshot?: string }
export interface ScenarioReceipt { id: string; label: string; version: string; snapshot: string; dataVersion: string; securityVersion: string; simulation: true;
  context: { company: string | number | boolean; companyField: FieldRef; filters: FilterRef[] }; contextHash: string;
  values: Record<string, number>; parameters: ScenarioParameter[]; outputs: (ScenarioOutput & { baseline: number | null; value: number | null; delta: number | null; percent: number | null })[] }
export interface ScenarioProposal { id: number; scenarioId: string; status: "pending" | "approved" | "rejected"; author: string; note: string; receipt: ScenarioReceipt; events: { status: string; actor: string; note: string; at: string }[] }
export interface ScenarioScope { scenarioId: string; filters: FilterRef[] }
export interface ScenarioProposalInput extends ScenarioScope { values: Record<string, number>; version: string; snapshot: string; requestKey: string; note: string }
export interface ScenarioHistory { items: ScenarioProposal[]; hasMore: boolean; canSubmit: boolean; canReview: boolean }
export interface ScenarioWorkflow { scope: string; history(input: ScenarioScope): Promise<ScenarioHistory>; create(input: ScenarioProposalInput): Promise<{ proposal: ScenarioProposal; replayed: boolean }>; decide(id: number, status: "approved" | "rejected", note: string): Promise<{ proposal: ScenarioProposal; replayed: boolean }> }
