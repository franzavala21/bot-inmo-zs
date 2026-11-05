import OpenAI, { toFile } from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { audioCost, emptyUsage, type Usage } from "./llm";

export interface Transcriber {
  transcribe(db: SupabaseClient, mediaPath: string): Promise<{ text: string; usage: Usage }>;
}

/** Audios de WhatsApp (ogg/opus de voz ≈ 2 KB por segundo). Estimación conservadora para el tope de gasto. */
const estimateSeconds = (bytes: number) => Math.ceil(bytes / 1500);

export class OpenAiTranscriber implements Transcriber {
  private client: OpenAI;
  constructor(private model = process.env.OPENAI_TRANSCRIBE_MODEL ?? "gpt-4o-mini-transcribe", apiKey = process.env.OPENAI_API_KEY) {
    if (!apiKey) throw new Error("Falta OPENAI_API_KEY");
    this.client = new OpenAI({ apiKey, timeout: 30_000, maxRetries: 1 });
  }

  async transcribe(db: SupabaseClient, mediaPath: string) {
    const { data, error } = await db.storage.from("media").download(mediaPath);
    if (error || !data) throw new Error(`no se pudo bajar el audio: ${error?.message ?? "vacío"}`);
    const buf = Buffer.from(await data.arrayBuffer());
    const ext = mediaPath.split(".").pop() || "ogg";
    const res = await this.client.audio.transcriptions.create({
      file: await toFile(buf, `audio.${ext}`), model: this.model, language: "es",
    });
    const seconds = estimateSeconds(buf.length);
    return { text: res.text.trim().slice(0, 4000), usage: { ...emptyUsage(), audioSeconds: seconds, costUsd: audioCost(seconds) } };
  }
}
