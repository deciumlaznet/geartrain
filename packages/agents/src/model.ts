// The model behind an agent. ClaudeModel calls the Claude API; tests and the
// keyless demo use ScriptedModel, which replays prepared turns. Agents only see
// this interface.

import Anthropic from "@anthropic-ai/sdk";

export type Message = Anthropic.Beta.BetaMessage;
export type MessageParam = Anthropic.Beta.BetaMessageParam;
export type ToolDefinition = Anthropic.Beta.BetaTool;

export interface ModelRequest {
  system: string;
  messages: MessageParam[];
  tools: ToolDefinition[];
}

export interface Model {
  readonly name: string;
  respond(req: ModelRequest): Promise<Message>;
}

export const DEFAULT_MODEL = "claude-opus-5-5";

/**
 * Claude via the Anthropic SDK. Thinking stays on (the model default); effort
 * is set explicitly because Opus 5.5 defaults to medium. A declined request is
 * re-run on a fallback model chosen by the API ("default" fallbacks).
 */
export class ClaudeModel implements Model {
  readonly name: string;
  private readonly client: Anthropic;

  constructor(opts: { apiKey?: string; model?: string; effort?: "low" | "medium" | "high"; client?: Anthropic } = {}) {
    this.name = opts.model ?? DEFAULT_MODEL;
    this.effort = opts.effort ?? "medium";
    this.client = opts.client ?? new Anthropic(opts.apiKey ? { apiKey: opts.apiKey } : {});
  }

  private readonly effort: "low" | "medium" | "high";

  async respond(req: ModelRequest): Promise<Message> {
    return this.client.beta.messages.create({
      model: this.name,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: this.effort },
      // The system prompt and tool list never change between calls, so they cache.
      cache_control: { type: "ephemeral" },
      system: req.system,
      tools: req.tools,
      messages: req.messages,
    });
  }
}

/** Replays prepared assistant turns, in order. For tests and the keyless demo. */
export class ScriptedModel implements Model {
  readonly name = "scripted";
  readonly requests: ModelRequest[] = [];
  private turn = 0;

  constructor(private readonly turns: Array<Message["content"]>) {}

  async respond(req: ModelRequest): Promise<Message> {
    this.requests.push(structuredClone(req));
    const content = this.turns[this.turn++];
    if (!content) throw new Error("ScriptedModel ran out of turns");
    return {
      id: `msg_scripted_${this.turn}`,
      type: "message",
      role: "assistant",
      model: this.name,
      content,
      stop_reason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    } as unknown as Message;
  }
}

/** Builders for scripted turns. */
export const say = (text: string) => ({ type: "text" as const, text, citations: null });
let toolUseCounter = 0;
export const call = (name: string, input: Record<string, unknown>) => ({
  type: "tool_use" as const,
  id: `toolu_scripted_${++toolUseCounter}`,
  name,
  input,
});
