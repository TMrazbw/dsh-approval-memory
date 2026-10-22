import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpenDamUiTool } from '../lib/open-tool.js';

test('open_dam_ui tool has a stable model-facing contract', () => {
  const tool = createOpenDamUiTool();
  assert.equal(tool.name, 'open_dam_ui');
  assert.match(tool.description, /DAM Approval Memory/i);
  assert.match(tool.description, /only opens/i);
  assert.equal(tool.parameters.type, 'object');
  assert.equal(tool.parameters.properties.reason.type, 'string');
  assert.equal(tool.output.schema.type, 'string');
  assert.equal(typeof tool.output.render, 'function');
  assert.deepEqual(tool.output.render({}, 'opened'), [{ type: 'text', text: 'opened' }]);
});

test('open_dam_ui execute returns a marker, not a rule change', async () => {
  const tool = createOpenDamUiTool();
  const result = await tool.execute({ reason: 'user asked' }, {});
  assert.equal(typeof result, 'string');
  assert.match(result, /panel requested/i);
  assert.match(result, /approval-memory/);
});

test('open_dam_ui accepts a custom panel id', async () => {
  const tool = createOpenDamUiTool({ panelId: 'custom-panel' });
  const result = await tool.execute({}, {});
  assert.match(result, /custom-panel/);
});

test('open_dam_ui is a plain ToolDefinition without an external defineTool dependency', () => {
  const tool = createOpenDamUiTool();
  assert.equal(typeof tool, 'object');
  assert.equal(typeof tool.execute, 'function');
  assert.equal(typeof tool.parameters, 'object');
  assert.equal(typeof tool.output, 'object');
});
