/** Business actions belong to this AIUI Agent; the SDK handles delivery and results. */
export function createCallTools(setOrbColor) {
  return [
    {
      name: 'setOrbColor',
      description:
        'Change the color of the orb on this screen when the user asks. Use default to restore its original appearance.',
      parameters: {
        type: 'object',
        properties: {
          color: { type: 'string', enum: ['default', 'blue', 'green', 'purple', 'orange'] },
        },
        required: ['color'],
        additionalProperties: false,
      },
      execute({ color }, { signal }) {
        signal.throwIfAborted();
        setOrbColor(color);
        return { color };
      },
    },
    {
      name: 'endConversation',
      description:
        'End this voice conversation only when the user explicitly asks to hang up or end the call. Do not use for a request to stop speaking or change topics.',
      parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
      execute(_, { endConversation }) {
        endConversation();
        return { ending: true };
      },
    },
  ];
}
