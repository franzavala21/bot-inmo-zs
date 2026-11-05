import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import type { z } from "zod";

export interface Usage { inputTokens: number; outputTokens: number; audioSeconds: number; costUsd: number }
export const emptyUsage = (): Usage => ({ inputTokens: 0, outputTokens: 0, audioSeconds: 0, costUsd: 0 });
export function addUsage(a: Usage, b: Usage): Usage {
  return { inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens,
    audioSeconds: a.audioSeconds + b.audioSeconds, costUsd: a.costUsd + b.costUsd };
}

// Precios en USD por millón de tokens (estimación para el tope diario; revisar si cambia el modelo).
const PRICES: Record<string, { in: number; out: number }> = {
  "gpt-4.1-mini": { in: 0.4, out: 1.6 },
  "gpt-4.1": { in: 2, out: 8 },
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
  "gpt-4o": { in: 2.5, out: 10 },
};
// Si el modelo no está en la tabla, se usa un precio alto: mejor frenar de más que gastar de más.
const FALLBACK_PRICE = { in: 2.5, out: 10 };
const TRANSCRIBE_USD_PER_MIN = 0.006;

export function textCost(model: string, inTok: number, outTok: number): number {
  const p = PRICES[model] ?? FALLBACK_PRICE;
  return (inTok * p.in + outTok * p.out) / 1_000_000;
}
export const audioCost = (seconds: number) => (seconds / 60) * TRANSCRIBE_USD_PER_MIN;

/** Lo único que los agentes saben del modelo. En los tests se reemplaza por uno falso. */
export interface Llm {
  structured<T extends z.ZodTypeAny>(args: {
    name: string; schema: T; system: string; user: string; temperature?: number;
  }): Promise<{ data: z.infer<T>; usage: Usage }>;
}

export class OpenAiLlm implements Llm {
  private client: OpenAI;
  constructor(private model = process.env.OPENAI_TEXT_MODEL ?? "gpt-4.1-mini", apiKey = process.env.OPENAI_API_KEY) {
    if (!apiKey) throw new Error("Falta OPENAI_API_KEY");
    this.client = new OpenAI({ apiKey, timeout: 25_000, maxRetries: 1 });
  }

  async structured<T extends z.ZodTypeAny>(args: { name: string; schema: T; system: string; user: string; temperature?: number }) {
    const res = await this.client.beta.chat.completions.parse({
      model: this.model,
      temperature: args.temperature ?? 0.2,
      messages: [{ role: "system", content: args.system }, { role: "user", content: args.user }],
      response_format: zodResponseFormat(args.schema, args.name),
    });
    const msg = res.choices[0]?.message;
    if (msg?.refusal) throw new Error(`el modelo se negó (${args.name})`);
    if (!msg?.parsed) throw new Error(`respuesta sin formato válido (${args.name})`);
    const inTok = res.usage?.prompt_tokens ?? 0;
    const outTok = res.usage?.completion_tokens ?? 0;
    return {
      data: msg.parsed as z.infer<T>,
      usage: { inputTokens: inTok, outputTokens: outTok, audioSeconds: 0, costUsd: textCost(this.model, inTok, outTok) },
    };
  }
}
