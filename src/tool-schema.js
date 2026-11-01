// A deliberately small JSON Schema subset shared by the client and reference backend.
// Reject unsupported constraints instead of advertising rules we cannot enforce locally.
export const TOOL_DATA_LIMIT = 8 * 1024;

export function jsonCopy(value, limit = TOOL_DATA_LIMIT) {
  const text = JSON.stringify(value);
  if (text === undefined || new TextEncoder().encode(text).length > limit)
    throw new TypeError('Tool data must be bounded JSON.');
  return JSON.parse(text);
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function schemaValid(schema, depth = 0) {
  if (!object(schema) || depth > 4) return false;
  const allowed = {
    string: ['enum', 'maxLength'],
    number: ['enum', 'minimum', 'maximum'],
    integer: ['enum', 'minimum', 'maximum'],
    boolean: [],
    object: ['properties', 'required', 'additionalProperties'],
    array: ['items', 'maxItems'],
  }[schema.type];
  if (
    !allowed ||
    Object.keys(schema).some((key) => !['type', 'description', ...allowed].includes(key))
  )
    return false;
  if (
    schema.description !== undefined &&
    (typeof schema.description !== 'string' || schema.description.length > 1200)
  )
    return false;
  if (
    schema.enum !== undefined &&
    (!Array.isArray(schema.enum) ||
      !schema.enum.length ||
      schema.enum.length > 32 ||
      schema.enum.some((value) => !matches({ ...schema, enum: undefined }, value)))
  )
    return false;
  for (const key of ['minimum', 'maximum'])
    if (schema[key] !== undefined && !Number.isFinite(schema[key])) return false;
  if (schema.minimum > schema.maximum) return false;
  for (const key of ['maxLength', 'maxItems'])
    if (
      schema[key] !== undefined &&
      (!Number.isInteger(schema[key]) || schema[key] < 0 || schema[key] > 4096)
    )
      return false;
  if (schema.type === 'array') return schemaValid(schema.items, depth + 1);
  if (schema.type === 'object') {
    if (
      !object(schema.properties) ||
      schema.additionalProperties !== false ||
      !Array.isArray(schema.required)
    )
      return false;
    const keys = Object.keys(schema.properties);
    // Required fields avoid unresolved {{args.name}} placeholders in Agora's HTTP templates.
    return (
      keys.length <= 32 &&
      schema.required.length === keys.length &&
      new Set(schema.required).size === keys.length &&
      keys.every(
        (key) =>
          /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key) &&
          !['constructor', 'prototype', '__proto__'].includes(key) &&
          schema.required.includes(key) &&
          schemaValid(schema.properties[key], depth + 1),
      )
    );
  }
  return true;
}

export function matches(schema, value) {
  if (schema.enum && !schema.enum.includes(value)) return false;
  switch (schema.type) {
    case 'string':
      return typeof value === 'string' && [...value].length <= (schema.maxLength ?? 4096);
    case 'boolean':
      return typeof value === 'boolean';
    case 'integer':
    case 'number':
      return (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        (schema.type !== 'integer' || Number.isInteger(value)) &&
        (schema.minimum === undefined || value >= schema.minimum) &&
        (schema.maximum === undefined || value <= schema.maximum)
      );
    case 'array':
      return (
        Array.isArray(value) &&
        value.length <= (schema.maxItems ?? 32) &&
        value.every((item) => matches(schema.items, item))
      );
    case 'object':
      return (
        object(value) &&
        Object.keys(value).length === schema.required.length &&
        schema.required.every(
          (key) => Object.hasOwn(value, key) && matches(schema.properties[key], value[key]),
        )
      );
    default:
      return false;
  }
}

/** Only these serializable descriptors go to the LLM; execute functions stay on the device. */
export function toolDefinitions(tools = []) {
  if (!Array.isArray(tools) || tools.length > 32)
    throw new TypeError('Provide at most 32 local tools.');
  const names = new Set();
  const definitions = tools.map((tool) => {
    if (
      !tool ||
      typeof tool.name !== 'string' ||
      !/^[a-zA-Z][a-zA-Z0-9]{0,63}$/.test(tool.name) ||
      /^mcp/i.test(tool.name) ||
      names.has(tool.name.toLowerCase()) ||
      typeof tool.description !== 'string' ||
      !tool.description.trim() ||
      tool.description.length > 1200
    )
      throw new TypeError('Provide unique tool names and descriptions.');
    names.add(tool.name.toLowerCase());
    const parameters = jsonCopy(tool.parameters);
    if (parameters.type !== 'object' || !schemaValid(parameters))
      throw new TypeError(
        'Unsupported tool parameter schema. Use required fields and additionalProperties: false.',
      );
    return { name: tool.name, description: tool.description, parameters };
  });
  return jsonCopy(definitions, 48 * 1024);
}

export function validCallId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
}
