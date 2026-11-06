'use strict';

// Yan Provider: natural-language service-provider configuration.
//
// The conversation owner gets a base URL, an API key and a loose description
// ("里面有几个生图模式，帮我配置一下"). This server turns that into a real
// connection: probe the catalog, create/update the connection, classify the
// models, enable them and bind the image/video roles.
//
// It never writes config.json itself. Credentials must be encrypted with the
// main process's safeStorage, and model/role changes have to publish through
// modelState, so every write goes over the authenticated local bridge that
// provider-ipc starts.

const net = require('net');

const bridgePort = Number(process.env.YAN_PROVIDER_BRIDGE_PORT || 0);
const bridgeToken = String(process.env.YAN_PROVIDER_BRIDGE_TOKEN || '');
const allowNetwork = process.env.YAN_PROVIDER_ALLOW_NETWORK !== 'false';
const BRIDGE_TIMEOUT_MS = 180_000;

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function success(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function failure(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message: String(message || 'Yan Provider error') } });
}

function toolResult(id, result) {
  success(id, {
    content: [{ type: 'text', text: JSON.stringify(result) }],
    structuredContent: result,
    isError: !!(result && (result.ok === false || result.error))
  });
}

function callBridge(action, params = {}) {
  return new Promise((resolve, reject) => {
    if (!bridgePort || !bridgeToken) {
      reject(new Error('服务商桥接尚未就绪：Yan 主进程没有提供配置桥接，请重启 Yan 后重试。'));
      return;
    }
    const socket = net.connect({ host: '127.0.0.1', port: bridgePort });
    let buffer = '';
    let settled = false;
    const done = (error, result) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch { /* already closed */ }
      if (error) reject(error); else resolve(result);
    };
    socket.setTimeout(BRIDGE_TIMEOUT_MS, () => done(new Error('服务商配置请求超时，请稍后重试。')));
    socket.on('connect', () => {
      socket.write(`${JSON.stringify({ token: bridgeToken, action, params })}\n`);
    });
    socket.setEncoding('utf8');
    socket.on('data', chunk => {
      buffer += String(chunk || '');
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      let message;
      try {
        message = JSON.parse(buffer.slice(0, newline).trim());
      } catch {
        done(new Error('服务商桥接返回了无效响应。'));
        return;
      }
      if (!message?.ok) {
        const error = new Error(String(message?.error || '服务商配置失败'));
        error.code = message?.code || 'YAN_PROVIDER_FAILED';
        done(error);
        return;
      }
      done(null, message.result);
    });
    socket.on('error', error => done(error));
  });
}

function requireNetwork() {
  if (!allowNetwork) {
    throw new Error('当前任务未允许网络访问，无法探测服务商模型目录。请允许网络后重试。');
  }
}

function summarizeConnections(result = {}) {
  const media = result.media || {};
  const connections = (Array.isArray(result.connections) ? result.connections : []).map(connection => ({
    ...connection,
    roles: {
      text: result.text?.providerId === connection.providerId ? result.text.modelId : '',
      image: media.imageProvider === connection.providerId ? media.imageModel : '',
      video: media.videoProvider === connection.providerId ? media.videoModel : ''
    }
  }));
  return {
    ok: true,
    connections,
    current: {
      text: result.text || null,
      image: media.imageProvider ? { providerId: media.imageProvider, modelId: media.imageModel } : null,
      video: media.videoProvider ? { providerId: media.videoProvider, modelId: media.videoModel } : null
    },
    imageGeneration: result.imageGeneration || null,
    videoGeneration: result.videoGeneration || null
  };
}

function toolDefinitions() {
  return [
    {
      name: 'list_provider_connections',
      description: 'List every configured API connection in Yan (name, Base URL, preset, models with their text/image/video role, and which model currently serves each role). Read-only; call it before configuring so an existing connection is updated instead of duplicated.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false }
    },
    {
      name: 'test_provider_connection',
      description: 'Probe one Base URL + API Key and return the model catalog it reports, without writing anything. Use it when the user only wants to check an endpoint, or when you need the model list before deciding how to configure it.',
      inputSchema: {
        type: 'object',
        properties: {
          base_url: { type: 'string', description: 'API Base URL, for example https://api.example.com/v1' },
          api_key: { type: 'string', description: 'API key for this endpoint.' },
          preset: { type: 'string', description: 'Optional compatibility preset (openai, anthropic, deepseek, glm, qwen, doubao, gemini, kimi, ...). Leave empty for automatic inference.' },
          api_format: { type: 'string', enum: ['auto', 'openai', 'anthropic', 'chat', 'responses'], description: 'Wire format. Leave empty/auto unless the endpoint is Anthropic-style.' }
        },
        required: ['base_url', 'api_key'],
        additionalProperties: false
      }
    },
    {
      name: 'configure_provider',
      description: 'Configure a service provider from natural language in one call: probe the Base URL catalog, create or update a Yan connection, classify the models as text/image/video (by vendor family and model name), enable them, and bind the image/video roles. Use this whenever the user gives a Base URL and API Key and asks to set up models — including "里面有几个生图模型，帮我配置一下" — instead of asking them to open Settings. Pass model ids only when the endpoint cannot list them or the user names them; otherwise omit models and let the probe discover them. The API key is stored encrypted by Yan and is never echoed back; the result contains a masked hint only. Media roles take effect for the next task.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Display name for the connection. Defaults to the Base URL host. Reusing the same name + Base URL updates that connection instead of adding a duplicate.' },
          base_url: { type: 'string', description: 'API Base URL, for example https://api.example.com/v1' },
          api_key: { type: 'string', description: 'API key. Required for a new connection; may be omitted when updating an existing one to keep the stored key.' },
          models: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional model ids to enable, e.g. ["gpt-4.1", "gpt-image-1"]. Omit to use the catalog reported by the endpoint.'
          },
          image_models: { type: 'array', items: { type: 'string' }, description: 'Model ids that generate images. Use when the user names them or the name is ambiguous.' },
          video_models: { type: 'array', items: { type: 'string' }, description: 'Model ids that generate videos.' },
          text_models: { type: 'array', items: { type: 'string' }, description: 'Model ids that must be treated as chat/text models.' },
          preset: { type: 'string', description: 'Optional compatibility preset (openai, anthropic, deepseek, glm, qwen, doubao, gemini, kimi, ...). Leave empty for automatic inference from the URL and model names.' },
          api_format: { type: 'string', enum: ['auto', 'openai', 'anthropic', 'chat', 'responses'], description: 'Wire format. Leave empty/auto unless the endpoint is Anthropic-style.' },
          image_generation_url: { type: 'string', description: 'Optional absolute POST URL for image generation when it is not the standard /images/generations under the Base URL.' },
          image_edit_url: { type: 'string', description: 'Optional absolute POST URL for image edits.' },
          video_generation_url: { type: 'string', description: 'Optional absolute POST URL for video generation when the relay exposes a non-standard path.' },
          main_model: { type: 'string', description: 'Optional model id to set as the main chat model. Omit to keep the current chat model untouched.' },
          image_model: { type: 'string', description: 'Optional model id to set as the image-generation model. Omit to keep the current one, or to auto-pick the first detected image model when none is configured yet.' },
          video_model: { type: 'string', description: 'Optional model id to set as the video-generation model.' },
          set_image_model: { type: 'boolean', description: 'Force replacing the current image model with the detected/selected one.' },
          set_video_model: { type: 'boolean', description: 'Force replacing the current video model with the detected/selected one.' },
          enable_all_models: { type: 'boolean', description: 'Enable every discovered model instead of only the classified media models and the chosen chat model.' },
          id: { type: 'string', description: 'Connection id to update, from list_provider_connections.' }
        },
        required: ['base_url'],
        additionalProperties: false
      }
    },
    {
      name: 'remove_provider_connection',
      description: 'Remove one API connection by id or name. Media roles that pointed at it are cleared and rebound to another configured provider when possible. Built-in vendor entries are only cleared, never deleted from the registry.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Connection id, e.g. conn-abc123.' },
          name: { type: 'string', description: 'Connection display name when the id is unknown.' }
        },
        additionalProperties: false
      }
    }
  ];
}

async function callTool(request) {
  const name = String(request.params?.name || '');
  const input = request.params?.arguments && typeof request.params.arguments === 'object' ? request.params.arguments : {};
  try {
    let result;
    switch (name) {
      case 'list_provider_connections': {
        result = summarizeConnections(await callBridge('provider.list'));
        break;
      }
      case 'test_provider_connection': {
        requireNetwork();
        const probe = await callBridge('provider.test', {
          baseUrl: String(input.base_url || '').trim(),
          apiKey: String(input.api_key || '').trim(),
          preset: input.preset,
          apiFormat: input.api_format
        });
        result = probe?.ok
          ? { ok: true, modelCount: probe.modelCount, models: probe.models || [] }
          : { ok: false, error: probe?.error || '无法读取模型列表' };
        break;
      }
      case 'configure_provider': {
        requireNetwork();
        result = await callBridge('provider.configure', input);
        break;
      }
      case 'remove_provider_connection': {
        const target = await callBridge('provider.remove', { id: input.id, name: input.name });
        result = target?.error ? { ok: false, error: target.error } : { ok: true, removed: true };
        break;
      }
      default:
        throw new Error(`Unknown Yan Provider tool: ${name}`);
    }
    toolResult(request.id, result);
  } catch (error) {
    toolResult(request.id, { ok: false, error: error?.message || String(error), code: error?.code || 'YAN_PROVIDER_TOOL_FAILED' });
  }
}

async function handle(message) {
  if (!message || message.jsonrpc !== '2.0') return;
  if (message.method === 'notifications/initialized') return;
  if (message.method === 'initialize') {
    success(message.id, {
      protocolVersion: String(message.params?.protocolVersion || '2025-03-26'),
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'Yan Provider', version: '1.0.0' }
    });
    return;
  }
  if (message.method === 'ping') {
    success(message.id, {});
    return;
  }
  if (message.method === 'tools/list') {
    success(message.id, { tools: toolDefinitions() });
    return;
  }
  if (message.method === 'tools/call') {
    await callTool(message);
    return;
  }
  if (message.id !== undefined) failure(message.id, -32601, `Unsupported method: ${message.method}`);
}

let buffered = '';
if (process.env.YAN_MCP_CATALOG_ONLY === '1') require('./mcp-tool-catalog').emitCatalog(toolDefinitions);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffered += String(chunk || '');
  while (true) {
    const newline = buffered.indexOf('\n');
    if (newline < 0) break;
    const line = buffered.slice(0, newline).trim();
    buffered = buffered.slice(newline + 1);
    if (!line) continue;
    try {
      void handle(JSON.parse(line));
    } catch (error) {
      failure(null, -32700, error?.message || String(error));
    }
  }
});
