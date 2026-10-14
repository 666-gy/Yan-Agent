// Some OpenAI-compatible schema validators reject ECMAScript's \0 escape.
// Keep the NUL constraint, but spell it as the portable hexadecimal escape.
export function portableSchemaPattern(pattern) {
  if (typeof pattern !== 'string') return pattern;
  let result = '';
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === '\u0000') { result += '\\x00'; continue; }
    if (char !== '\\' || i + 1 >= pattern.length) { result += char; continue; }
    const next = pattern[++i];
    result += next === '\u0000' || (next === '0' && !/[0-9]/.test(pattern[i + 1] || ''))
      ? '\\x00' : '\\' + next;
  }
  return result;
}

const singleSchemas = new Set(['items', 'additionalItems', 'additionalProperties',
  'unevaluatedItems', 'unevaluatedProperties', 'contains', 'propertyNames', 'not', 'if', 'then', 'else']);
const schemaArrays = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems']);
const schemaMaps = new Set(['properties', '$defs', 'definitions', 'dependentSchemas']);

export function portableToolSchema(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return schema;
  const result = { ...schema };
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'pattern') result[key] = portableSchemaPattern(value);
    else if (singleSchemas.has(key)) result[key] = Array.isArray(value)
      ? value.map(portableToolSchema) : portableToolSchema(value);
    else if (schemaArrays.has(key) && Array.isArray(value)) result[key] = value.map(portableToolSchema);
    else if (schemaMaps.has(key) && value && typeof value === 'object') {
      result[key] = Object.fromEntries(Object.entries(value).map(([name, child]) => [name, portableToolSchema(child)]));
    } else if (key === 'patternProperties' && value && typeof value === 'object') {
      result[key] = Object.fromEntries(Object.entries(value).map(([pattern, child]) => [portableSchemaPattern(pattern), portableToolSchema(child)]));
    }
  }
  return result;
}

export function portableToolPatterns(body) {
  if (!body || !Array.isArray(body.tools)) return body;
  return { ...body, tools: body.tools.map(tool => {
    if (tool.type !== 'function') return tool;
    if (tool.function?.parameters) return { ...tool, function: {
      ...tool.function, parameters: portableToolSchema(tool.function.parameters)
    } };
    return tool.parameters ? { ...tool, parameters: portableToolSchema(tool.parameters) } : tool;
  }) };
}
