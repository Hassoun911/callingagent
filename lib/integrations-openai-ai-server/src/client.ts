import OpenAI from "openai";

const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ?? "https://api.openai.com/v1";

if (!apiKey) {
  throw new Error(
    "No OpenAI API key found. Set OPENAI_API_KEY (or AI_INTEGRATIONS_OPENAI_API_KEY on Replit).",
  );
}

export const openai = new OpenAI({ apiKey, baseURL });
