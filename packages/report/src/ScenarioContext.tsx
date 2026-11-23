import { createContext, useContext, type ReactNode } from "react";
import type { ScenarioDefinition, ScenarioWorkflow } from "@floem/client";
const Context = createContext<{ definitions: ScenarioDefinition[]; workflow?: ScenarioWorkflow }>({ definitions: [] });
export function ScenarioProvider({ definitions = [], workflow, children }: { definitions?: ScenarioDefinition[]; workflow?: ScenarioWorkflow; children: ReactNode }) {
  return <Context.Provider value={{ definitions, workflow }}>{children}</Context.Provider>;
}
export const useScenarios = () => useContext(Context);
