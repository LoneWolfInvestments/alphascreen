export const MAX_QUESTION_CHARS = 2000;
export const MAX_CONTEXT_CHARS = 4000;

// Reject oversized or non-text bodies before they are sent to Anthropic.
export function readAnalystBody(body) {
  const question = body?.question;
  const context = body?.context;

  if (typeof question !== "string" || question.trim().length === 0) {
    return { error: "Missing question", status: 400 };
  }
  if (question.length > MAX_QUESTION_CHARS) {
    return { error: `Question is too long (max ${MAX_QUESTION_CHARS} characters).`, status: 400 };
  }
  if (context != null && typeof context !== "string") {
    return { error: "Context must be plain text.", status: 400 };
  }
  if (typeof context === "string" && context.length > MAX_CONTEXT_CHARS) {
    return { error: `Context is too long (max ${MAX_CONTEXT_CHARS} characters).`, status: 400 };
  }

  return {
    question: question.trim(),
    context: typeof context === "string" ? context : "",
  };
}
