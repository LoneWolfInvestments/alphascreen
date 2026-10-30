// api/ask-analyst.js
// Calls the Anthropic API server-side, keeping your API key off the client.
// Only a signed-in owner (an email listed in allowed_owners) can call it.
// Set a monthly spend limit in the Anthropic console as a second safety net.

import { readAnalystBody } from "../server/analystBody.js";
import { requireOwner } from "../server/requireOwner.js";

const HOUR_MS = 60 * 60 * 1000;
const MAX_BODY_BYTES = 20_000;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const contentLength = Number(req.headers["content-length"] || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return res.status(413).json({ error: "Request is too large." });
  }

  const owner = await requireOwner(req, res, {
    bucket: "ask-analyst",
    limit: 15,
    windowMs: HOUR_MS,
  });
  if (!owner) return;

  const parsed = readAnalystBody(req.body);
  if (parsed.error) {
    return res.status(parsed.status).json({ error: parsed.error });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY is not configured on the server" });
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 500,
        messages: [
          {
            role: "user",
            content: `You are an equity research analyst assistant embedded in a screening tool called AlphaScreen. Answer with institutional-grade analytical depth: be specific, quantify bear/bull cases where possible, and give a clear verdict. Keep it under 200 words. ${parsed.context}\n\nQuestion: ${parsed.question}`,
          },
        ],
      }),
    });

    const data = await response.json();

    if (data.error) {
      return res.status(502).json({ error: data.error.message || "Anthropic API error" });
    }

    const text = (data.content || []).map((block) => block.text || "").join("\n");
    return res.status(200).json({ text });
  } catch (err) {
    return res.status(500).json({ error: "Failed to reach Anthropic API", detail: err.message });
  }
}
