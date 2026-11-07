// The agent loop. Every tool carries a risk class, and the loop (not the model)
// decides what happens:
//   read, reversible   -> runs
//   externalFinancial  -> does not run; becomes a proposal for the approvals inbox
//   blocked            -> never runs; the model is told to hand it to a person
// Tool inputs are checked against their schema before anything runs.

import type { Message, MessageParam, Model, ToolDefinition } from "./model.ts";

export type RiskClass = "read" | "reversible" | "externalFinancial" | "blocked";

export interface AgentTool<In = Record<string, unknown>> {
  definition: ToolDefinition;
  risk: RiskClass;
  /** Runs for read and reversible tools only. Returns text for the model. */
  run?: (input: In) => Promise<string>;
}

export interface Proposal {
  tool: string;
  risk: "externalFinancial" | "blocked";
  input: Record<string, unknown>;
}

export interface ActionRecord {
  tool: string;
  risk: RiskClass;
  input: Record<string, unknown>;
  outcome: "ran" | "proposed" | "refused" | "invalid" | "failed";
  result: string;
}

export interface AgentRun {
  finalText: string;
  actions: ActionRecord[];
  proposals: Proposal[];
  turns: number;
  stopReason: Message["stop_reason"];
  model: string;
}

export interface RunOptions {
  model: Model;
  system: string;
  prompt: string;
  tools: AgentTool<any>[];
  maxTurns?: number;
}

export async function runAgent(opts: RunOptions): Promise<AgentRun> {
  const byName = new Map(opts.tools.map((t) => [t.definition.name, t]));
  const definitions = opts.tools.map((t) => t.definition);
  const messages: MessageParam[] = [{ role: "user", content: opts.prompt }];
  const actions: ActionRecord[] = [];
  const proposals: Proposal[] = [];
  const maxTurns = opts.maxTurns ?? 12;
  let last: Message | undefined;
  let turns = 0;

  while (turns < maxTurns) {
    turns++;
    last = await opts.model.respond({ system: opts.system, messages, tools: definitions });
    // Append the whole response, thinking blocks included, unchanged.
    messages.push({ role: "assistant", content: last.content });
    if (last.stop_reason !== "tool_use") break;

    const results: Array<{ type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }> = [];
    for (const block of last.content) {
      if (block.type !== "tool_use") continue;
      const input = (block.input ?? {}) as Record<string, unknown>;
      const record = await handle(byName.get(block.name), block.name, input, proposals);
      actions.push(record);
      results.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: record.result,
        ...(record.outcome === "ran" || record.outcome === "proposed" ? {} : { is_error: true }),
      });
    }
    // All results go back in one user message.
    messages.push({ role: "user", content: results });
  }

  const finalText = (last?.content ?? [])
    .filter((b): b is Extract<Message["content"][number], { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  return { finalText, actions, proposals, turns, stopReason: last?.stop_reason ?? null, model: opts.model.name };
}

async function handle(
  tool: AgentTool<any> | undefined,
  name: string,
  input: Record<string, unknown>,
  proposals: Proposal[],
): Promise<ActionRecord> {
  if (!tool) return { tool: name, risk: "blocked", input, outcome: "invalid", result: `There is no tool called ${name}.` };
  const problem = validate(tool.definition, input);
  if (problem) return { tool: name, risk: tool.risk, input, outcome: "invalid", result: `Invalid input: ${problem}` };

  switch (tool.risk) {
    case "blocked":
      proposals.push({ tool: name, risk: "blocked", input });
      return {
        tool: name,
        risk: "blocked",
        input,
        outcome: "refused",
        result: "Refused: agents may never do this. It has been raised for a person to verify outside the app. Do not try another way.",
      };
    case "externalFinancial":
      proposals.push({ tool: name, risk: "externalFinancial", input });
      return { tool: name, risk: "externalFinancial", input, outcome: "proposed", result: "Not done. Queued in the approvals inbox for a person to decide." };
    default:
      try {
        return { tool: name, risk: tool.risk, input, outcome: "ran", result: await tool.run!(input) };
      } catch (e) {
        return { tool: name, risk: tool.risk, input, outcome: "failed", result: `Failed: ${(e as Error).message}` };
      }
  }
}

/** Minimal JSON Schema check: object shape, required keys, primitive types, enums, no extra keys. */
export function validate(def: ToolDefinition, input: unknown): string | undefined {
  const schema = def.input_schema as {
    properties?: Record<string, { type?: string; enum?: unknown[]; items?: { type?: string } }>;
    required?: string[];
  };
  if (typeof input !== "object" || input === null || Array.isArray(input)) return "expected an object";
  const obj = input as Record<string, unknown>;
  const props = schema.properties ?? {};
  for (const key of schema.required ?? []) if (!(key in obj)) return `missing ${key}`;
  for (const [key, value] of Object.entries(obj)) {
    const p = props[key];
    if (!p) return `unexpected field ${key}`;
    if (p.enum && !p.enum.includes(value)) return `${key} must be one of ${p.enum.join(", ")}`;
    if (p.type && !matches(p.type, value)) return `${key} must be ${p.type}`;
    if (p.type === "array" && p.items?.type && !(value as unknown[]).every((v) => matches(p.items!.type!, v))) return `${key} items must be ${p.items.type}`;
  }
  return undefined;
}

function matches(type: string, v: unknown): boolean {
  switch (type) {
    case "string":
      return typeof v === "string";
    case "integer":
      return Number.isInteger(v);
    case "number":
      return typeof v === "number" && Number.isFinite(v);
    case "boolean":
      return typeof v === "boolean";
    case "array":
      return Array.isArray(v);
    case "object":
      return typeof v === "object" && v !== null && !Array.isArray(v);
    default:
      return true;
  }
}
