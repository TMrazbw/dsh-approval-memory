/**
 * DAM — `open_dam_ui` tool definition.
 *
 * The Host tool does not open the panel itself: it returns a small marker and
 * the Web client's `tool.call.toolview` for this tool performs the actual
 * `ctx.layout.selectPanel('approval-memory')` navigation. The tool therefore
 * has no authority over rules or data.
 *
 * The definition is a plain `ToolDefinition` object (no `@deepseek-ai/dsh-tools`
 * import) so a locally installed bundle does not need a dependency edge on the
 * DSH installation's private package graph.
 */

/**
 * Build the `open_dam_ui` tool definition.
 * @param {object} [options] - tool factory options.
 * @param {string} [options.panelId] - main panel key.
 * @returns {object} the tool definition.
 */
export function createOpenDamUiTool(options = {}) {
  const panelId = typeof options.panelId === 'string' && options.panelId.length > 0
    ? options.panelId
    : 'approval-memory';

  return {
    name: 'open_dam_ui',
    description: 'Open the DAM Approval Memory panel in the DSH Web UI. Call this whenever the user asks to open, show, or view the DAM UI, approval-memory panel, approval statistics, or request rules (for example “我要看 DAM 的界面”). The tool only opens the local panel; it never changes rules or data.',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Optional short summary of what the user asked to see.',
        },
      },
      additionalProperties: false,
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    async execute() {
      return `DAM approval-memory panel requested (${panelId}); the Web UI opens it when this tool result renders.`;
    },
  };
}
