import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { AppError } from "../utils/errors.mjs";

let client = null;

export function requireOpenAIClient() {
  if (process.env.OPENAI_MOCK === "1") return null;

  if (!process.env.OPENAI_API_KEY) {
    throw new AppError(
      "missing_openai_api_key",
      "OPENAI_API_KEY is required for real research debate. Use ?static=1 only for the explicit static demo.",
      500
    );
  }

  client ||= new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

export async function createJsonResponse({
  model,
  reasoningEffort = "low",
  instructions,
  input,
  maxOutputTokens = 1800,
  schema = null,
  schemaName = "structured_output"
}) {
  const openai = requireOpenAIClient();
  const body = {
    model,
    store: false,
    reasoning: { effort: reasoningEffort },
    max_output_tokens: maxOutputTokens,
    instructions,
    input: [
      {
        role: "user",
        content: [{ type: "input_text", text: input }]
      }
    ]
  };

  if (schema) {
    body.text = { format: zodTextFormat(schema, schemaName) };
    const response = await openai.responses.parse(body);
    if (response.output_parsed) return response.output_parsed;
    return schema.parse(parseJsonFromText(extractOutputText(response)));
  }

  const response = await openai.responses.create(body);
  return parseJsonFromText(extractOutputText(response));
}

export function extractOutputText(data) {
  if (typeof data?.output_text === "string") return data.output_text;

  return (data?.output || [])
    .flatMap((item) => item.content || [])
    .filter((content) => content.type === "output_text" || content.type === "text")
    .map((content) => content.text || "")
    .join("\n")
    .trim();
}

export function parseJsonFromText(text) {
  const trimmed = String(text || "").trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(unfenced);
  } catch {
    const match = unfenced.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (match) return JSON.parse(match[0]);
    throw new AppError("openai_invalid_json", "The model did not return valid JSON.", 502);
  }
}
