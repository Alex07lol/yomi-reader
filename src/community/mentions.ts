/* ─── @mention parsing ───
   Mentions are plain text (`@username`), never HTML, so rendering a comment
   body can build DOM nodes safely. The username grammar matches the profile
   constraint (3–24 lowercase letters, digits or underscores). */

export const MENTION_PATTERN = /@([A-Za-z0-9_]{3,24})/g;
export const USERNAME_PATTERN = /^[a-z0-9_]{3,24}$/;

export type MentionToken =
  | { type: 'text'; value: string }
  | { type: 'mention'; value: string; username: string };

/**
 * Splits text into literal runs and mention tokens, preserving order. The
 * matched username is lowercased (profile handles are stored lowercase) while
 * `value` keeps the original casing a reader typed.
 */
export function tokenizeMentions(text: string): MentionToken[] {
  const tokens: MentionToken[] = [];
  if (!text) return tokens;
  let lastIndex = 0;
  MENTION_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MENTION_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }
    tokens.push({ type: 'mention', value: match[0], username: match[1].toLowerCase() });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) tokens.push({ type: 'text', value: text.slice(lastIndex) });
  return tokens;
}

/** Unique, lowercased usernames mentioned in the text, in first-seen order. */
export function extractMentions(text: string): string[] {
  const seen = new Set<string>();
  const found: string[] = [];
  for (const token of tokenizeMentions(text)) {
    if (token.type === 'mention' && !seen.has(token.username)) {
      seen.add(token.username);
      found.push(token.username);
    }
  }
  return found;
}
