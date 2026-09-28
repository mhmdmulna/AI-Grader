/** Parse a JSON response without accepting arbitrary prose around it. */
export function parseStructuredJson(content: string): unknown {
  const trimmed = content.trim().replace(/^\uFEFF/, '');
  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fencedMatch ? fencedMatch[1].trim() : trimmed;

  if (!candidate) {
    throw new SyntaxError('Response content is empty');
  }

  return JSON.parse(candidate) as unknown;
}
