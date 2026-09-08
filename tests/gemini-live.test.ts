import { describe, expect, it } from "vitest";
import { z } from "zod";
import { estimateAiCostUsd } from "../src/lib/adapters/ai";
import { generateGeminiStructured } from "../src/lib/adapters/gemini";

const liveEnabled = process.env.RUN_LIVE_GEMINI === "1" && process.env.GEMINI_BILLING_CONFIRMED === "1";

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    ok: { type: "boolean" },
    answer: { type: "string", enum: ["yes", "no"] },
  },
  required: ["ok", "answer"],
} as const;

const validator = z.object({ ok: z.boolean(), answer: z.enum(["yes", "no"]) });

describe("opt-in live Gemini shape", () => {
  it.skipIf(!liveEnabled)("accepts a tiny sealed schema and reports bounded usage", async () => {
    const model = process.env.GEMINI_FAST_MODEL?.trim();
    const hasApiKey = Boolean(process.env.GEMINI_API_KEY?.trim());
    if (!model || !hasApiKey) {
      const missing = !hasApiKey ? "GEMINI_API_KEY" : "GEMINI_FAST_MODEL";
      throw new Error(`Opted-in live Gemini verification is missing ${missing}`);
    }

    const generated = await generateGeminiStructured({
      model,
      input: "Return the fixed sealed verification object with ok true and answer yes.",
      schemaName: "sealed_live_shape_v1",
      schema,
      validator,
      maxOutputTokens: 64,
      timeoutMs: 15_000,
    });

    expect(generated.value).toEqual({ ok: true, answer: "yes" });
    const inputTokens = generated.usage?.inputTokens;
    const outputTokens = generated.usage?.outputTokens;
    const totalTokens = generated.usage?.totalTokens;
    expect(Number.isFinite(inputTokens) && Number.isInteger(inputTokens) && (inputTokens ?? 0) > 0).toBe(true);
    expect(Number.isFinite(outputTokens) && Number.isInteger(outputTokens) && (outputTokens ?? 0) > 0).toBe(true);
    expect(Number.isFinite(totalTokens) && Number.isInteger(totalTokens) && (totalTokens ?? 0) > 0).toBe(true);
    const conservativeLedgerCostUsd = estimateAiCostUsd("gemini", model, inputTokens as number, outputTokens as number);
    expect(Number.isFinite(conservativeLedgerCostUsd)).toBe(true);
    console.info("Gemini live shape verified", { model, inputTokens, outputTokens, totalTokens, conservativeLedgerCostUsd });
  });
});
