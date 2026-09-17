// api/ask-analyst.js
// Calls the Anthropic API server-side, keeping your API key off the client.
// Requires an ANTHROPIC_API_KEY environment variable (get one at console.anthropic.com).

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { question, context } = req.body || {};
  if (!question) {
    return res.status(400).json({ error: "Missing question" });
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
            content: `You are an equity research analyst assistant embedded in a screening tool called AlphaScreen. Answer with institutional-grade analytical depth: be specific, quantify bear/bull cases where possible, and give a clear verdict. Keep it under 200 words. ${context || ""}\n\nQuestion: ${question}`,
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
