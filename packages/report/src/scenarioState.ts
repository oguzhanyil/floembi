import type { ScenarioDefinition, ScenarioReceipt } from "@floem/client";

export function scenarioValues(definition: ScenarioDefinition, draft: Record<string, string>): { values: Record<string, number>; error?: string } {
  const values: Record<string, number> = {};
  for (const p of definition.parameters) {
    const text = draft[p.id] ?? String(p.defaultValue), value = Number(text);
    const count = (value - p.minimum) / p.step;
    if (!text.trim() || !Number.isFinite(value) || value < p.minimum || value > p.maximum || Math.abs(count - Math.round(count)) > 1e-7)
      return { values: {}, error: `${p.label}: ${p.minimum}–${p.maximum} aralığında, ${p.step} adımıyla değer girin.` };
    values[p.id] = value;
  }
  return { values };
}
export function scenarioReceiptMatches(receipt: ScenarioReceipt | undefined, definition: ScenarioDefinition, values: Record<string, number>): receipt is ScenarioReceipt {
  return !!receipt && receipt.simulation === true && receipt.id === definition.id
    && definition.parameters.every((p) => receipt.values[p.id] === values[p.id])
    && receipt.outputs.length === definition.outputs.length && receipt.outputs.every((o, i) => o.measure === definition.outputs[i].measure);
}
