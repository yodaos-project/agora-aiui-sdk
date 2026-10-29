const MAX_MESSAGES = 20;
const MAX_TEXT = 2000;
const MAX_TOTAL_TEXT = 12000;

/** Copy a bounded history snapshot; these messages do not carry audio timing. */
export function transcriptSnapshot(messages) {
  if (!Array.isArray(messages)) throw new TypeError('Expected a transcript snapshot.');
  const output = [];
  const seen = new Set();
  let remaining = MAX_TOTAL_TEXT;
  const first = Math.max(0, messages.length - MAX_MESSAGES);
  for (let index = messages.length - 1; index >= first; index--) {
    const message = messages[index];
    if (
      !message ||
      !['user', 'assistant'].includes(message.role) ||
      typeof message.id !== 'string' ||
      !message.id ||
      message.id.length > 256 ||
      typeof message.text !== 'string'
    ) {
      throw new TypeError('Invalid transcript message.');
    }
    if (!message.text.slice(0, MAX_TEXT).trim()) continue;
    if (seen.has(message.id)) continue;
    seen.add(message.id);
    if (!remaining) break;
    const text = message.text.slice(0, Math.min(MAX_TEXT, remaining));
    remaining -= text.length;
    output.push(
      Object.freeze({
        id: message.id,
        role: message.role,
        text,
        interrupted: message.interrupted === true,
        ...(['in-progress', 'final', 'interrupted'].includes(message.status)
          ? { status: message.status }
          : {}),
      }),
    );
  }
  return Object.freeze(output.reverse());
}

/** Keep only display text from Agora history; credentials and provider metadata stay behind. */
export function historySnapshot(contents) {
  if (!Array.isArray(contents)) throw new TypeError('Missing Agora history.');
  const offset = Math.max(0, contents.length - MAX_MESSAGES);
  return transcriptSnapshot(
    contents.slice(offset).flatMap((entry, index) => {
      if (!['user', 'assistant'].includes(entry?.role) || typeof entry.content !== 'string') {
        return [];
      }
      const turn = Number.isSafeInteger(entry.turn_id) ? entry.turn_id : offset + index;
      return [
        {
          id: `${entry.role}:${turn}`,
          role: entry.role,
          text: entry.content,
          interrupted: entry.metadata?.interrupted === true,
        },
      ];
    }),
  );
}
