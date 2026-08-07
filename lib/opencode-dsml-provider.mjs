import { randomUUID } from 'node:crypto';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import dsmlToolCall from './dsml-tool-call.js';

const {
  MAX_DSML_RESPONSE_BYTES,
  containsDsmlToolCallMarkup,
  recoverDsmlToolCalls
} = dsmlToolCall;

const PLAIN_TEXT_TAIL = 256;
const DSML_START = /<[|｜]{2}\s*DSML\s*[|｜]{2}tool_calls\s*>/iu;
const DSML_END = /<\/[|｜]{2}\s*DSML\s*[|｜]{2}tool_calls\s*>/iu;
const LANGUAGE_MODEL_METHODS = new Set(['languageModel', 'chatModel', 'completionModel']);
const OCTET_STREAM = 'application/octet-stream';
const IMAGE_MEDIA_TYPES_BY_EXTENSION = Object.freeze({
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml'
});
const TEXT_ATTACHMENT_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.cxx', '.h', '.hh', '.hpp', '.hxx', '.java', '.js', '.jsx', '.ts', '.tsx',
  '.py', '.pyi', '.rs', '.go', '.cs', '.php', '.rb', '.swift', '.kt', '.kts', '.json', '.jsonc',
  '.md', '.markdown', '.txt', '.html', '.htm', '.css', '.scss', '.sass', '.less', '.xml', '.yaml',
  '.yml', '.toml', '.ini', '.cfg', '.conf', '.env', '.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd',
  '.sql', '.vue', '.svelte', '.astro', '.cmake', '.gradle', '.properties', '.gitignore'
]);

function attachmentExtension(filename) {
  const value = String(filename || '').trim().toLowerCase();
  const dot = value.lastIndexOf('.');
  return dot >= 0 ? value.slice(dot) : '';
}

function attachmentMediaType(part) {
  const declared = String(part?.mediaType || part?.mimeType || '').trim().toLowerCase();
  if (declared && declared !== OCTET_STREAM) return declared;
  return IMAGE_MEDIA_TYPES_BY_EXTENSION[attachmentExtension(part?.filename)] || declared;
}

function attachmentBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (typeof data !== 'string' || !data) return null;
  const comma = data.indexOf(',');
  const encoded = data.startsWith('data:') && comma >= 0 ? data.slice(comma + 1) : data;
  try { return Uint8Array.from(Buffer.from(encoded, 'base64')); } catch { return null; }
}

function attachmentTextPart(part) {
  const filename = String(part?.filename || 'unnamed attachment');
  const extension = attachmentExtension(filename);
  const bytes = attachmentBytes(part?.data);
  if (TEXT_ATTACHMENT_EXTENSIONS.has(extension) && bytes?.length && !bytes.includes(0)) {
    const text = new TextDecoder().decode(bytes);
    return {
      type: 'text',
      text: `[Attached text file: ${filename}]\n${text}`
    };
  }
  return {
    type: 'text',
    text: `[Attached file: ${filename}. The current text runtime cannot read this binary attachment directly.]`
  };
}

export function normalizeDsmlPrompt(prompt = []) {
  return (Array.isArray(prompt) ? prompt : []).map(message => {
    if (!Array.isArray(message?.content)) return message;
    let changed = false;
    const content = message.content.flatMap(part => {
      if (part?.type !== 'file') return [part];
      const mediaType = attachmentMediaType(part);
      const supported = mediaType.startsWith('image/')
        || mediaType.startsWith('audio/')
        || mediaType.startsWith('text/')
        || mediaType === 'application/pdf';
      if (supported) {
        if (mediaType && mediaType !== part.mediaType) {
          changed = true;
          return [{ ...part, mediaType }];
        }
        return [part];
      }
      changed = true;
      return [attachmentTextPart(part)];
    });
    return changed ? { ...message, content } : message;
  });
}

function createCallId() {
  return `call_${randomUUID().replaceAll('-', '')}`;
}

function dsmlError(message) {
  return new Error(`DeepSeek DSML compatibility failed: ${message}`);
}

class DsmlTextDecoder {
  constructor() {
    this.pending = '';
    this.readingProtocol = false;
    this.converted = false;
  }

  push(value) {
    this.pending += String(value || '');
    return this.#drain(false);
  }

  finish() {
    return this.#drain(true);
  }

  #drain(final) {
    const output = [];
    while (this.pending) {
      if (!this.readingProtocol) {
        const start = this.pending.search(DSML_START);
        if (start < 0) {
          if (final) {
            if (containsDsmlToolCallMarkup(this.pending)) {
              throw dsmlError('DeepSeek returned an incomplete DSML Tool Call block.');
            }
            output.push({ type: 'text', text: this.pending });
            this.pending = '';
          } else if (this.pending.length > PLAIN_TEXT_TAIL) {
            const flushLength = this.pending.length - PLAIN_TEXT_TAIL;
            output.push({ type: 'text', text: this.pending.slice(0, flushLength) });
            this.pending = this.pending.slice(flushLength);
          }
          break;
        }

        if (start > 0) output.push({ type: 'text', text: this.pending.slice(0, start) });
        this.pending = this.pending.slice(start);
        this.readingProtocol = true;
      }

      const end = DSML_END.exec(this.pending);
      if (!end) {
        if (Buffer.byteLength(this.pending, 'utf8') > MAX_DSML_RESPONSE_BYTES) {
          throw dsmlError(`DSML Tool Call exceeded ${MAX_DSML_RESPONSE_BYTES} bytes.`);
        }
        if (final) throw dsmlError('DeepSeek returned an incomplete DSML Tool Call block.');
        break;
      }

      const blockEnd = end.index + end[0].length;
      const block = this.pending.slice(0, blockEnd);
      const recovered = recoverDsmlToolCalls(block);
      if (recovered.error || !recovered.calls.length) {
        throw dsmlError(recovered.error || 'DSML did not contain a Tool Call.');
      }
      output.push({ type: 'calls', calls: recovered.calls });
      this.converted = true;
      this.pending = this.pending.slice(blockEnd);
      this.readingProtocol = false;
    }
    return output;
  }
}

function toolCallContent(calls) {
  return calls.map(call => ({
    type: 'tool-call',
    toolCallId: createCallId(),
    toolName: call.toolId,
    input: JSON.stringify(call.args)
  }));
}

function toolCallStreamParts(calls) {
  return calls.flatMap(call => {
    const id = createCallId();
    const input = JSON.stringify(call.args);
    return [
      { type: 'tool-input-start', id, toolName: call.toolId },
      { type: 'tool-input-delta', id, delta: input },
      { type: 'tool-input-end', id },
      { type: 'tool-call', toolCallId: id, toolName: call.toolId, input }
    ];
  });
}

function toolCallFinishReason(finishReason) {
  return finishReason && typeof finishReason === 'object'
    ? { ...finishReason, unified: 'tool-calls', raw: 'tool_calls' }
    : 'tool-calls';
}

export function transformDsmlGenerateResult(result) {
  const content = [];
  let converted = false;

  for (const part of Array.isArray(result?.content) ? result.content : []) {
    if (part?.type !== 'text' && part?.type !== 'reasoning') {
      content.push(part);
      continue;
    }
    const decoder = new DsmlTextDecoder();
    const decoded = [...decoder.push(part.text), ...decoder.finish()];
    for (const item of decoded) {
      if (item.type === 'text') {
        if (item.text) content.push({ ...part, text: item.text });
      } else {
        content.push(...toolCallContent(item.calls));
      }
    }
    converted ||= decoder.converted;
  }

  return converted
    ? { ...result, content, finishReason: toolCallFinishReason(result?.finishReason) }
    : { ...result, content };
}

class DsmlStreamChannel {
  constructor(type) {
    this.type = type;
    this.decoder = new DsmlTextDecoder();
    this.sourceId = `${type}-0`;
    this.outputId = '';
    this.outputIndex = 0;
    this.finished = false;
    this.convertedEarlier = false;
  }

  get converted() {
    return this.convertedEarlier || this.decoder.converted;
  }

  start(id) {
    this.#resume();
    this.sourceId = String(id || this.sourceId);
  }

  push(id, value, controller) {
    this.#resume();
    this.sourceId = String(id || this.sourceId);
    this.#append(this.decoder.push(value), controller);
  }

  finish(controller) {
    if (this.finished) return;
    this.#append(this.decoder.finish(), controller);
    this.#close(controller);
    this.finished = true;
  }

  #resume() {
    if (!this.finished) return;
    this.convertedEarlier ||= this.decoder.converted;
    this.decoder = new DsmlTextDecoder();
    this.finished = false;
  }

  #append(items, controller) {
    for (const item of items) {
      if (item.type === 'text') {
        if (!item.text) continue;
        if (!this.outputId) {
          this.outputId = `${this.sourceId}-yan-${this.outputIndex++}`;
          controller.enqueue({ type: `${this.type}-start`, id: this.outputId });
        }
        controller.enqueue({ type: `${this.type}-delta`, id: this.outputId, delta: item.text });
      } else {
        this.#close(controller);
        for (const toolPart of toolCallStreamParts(item.calls)) controller.enqueue(toolPart);
      }
    }
  }

  #close(controller) {
    if (!this.outputId) return;
    controller.enqueue({ type: `${this.type}-end`, id: this.outputId });
    this.outputId = '';
  }
}

export function transformDsmlStream(stream) {
  const channels = {
    text: new DsmlStreamChannel('text'),
    reasoning: new DsmlStreamChannel('reasoning')
  };
  let finished = false;

  const finishChannels = controller => {
    if (finished) return;
    channels.reasoning.finish(controller);
    channels.text.finish(controller);
    finished = true;
  };
  const converted = () => channels.text.converted || channels.reasoning.converted;

  return stream.pipeThrough(new TransformStream({
    transform(part, controller) {
      for (const type of ['text', 'reasoning']) {
        if (part?.type === `${type}-start`) {
          channels[type].start(part.id);
          return;
        }
        if (part?.type === `${type}-delta`) {
          channels[type].push(part.id, part.delta, controller);
          return;
        }
        if (part?.type === `${type}-end`) {
          channels[type].finish(controller);
          return;
        }
      }
      if (part?.type === 'finish') {
        finishChannels(controller);
        controller.enqueue(converted()
          ? { ...part, finishReason: toolCallFinishReason(part.finishReason) }
          : part);
        return;
      }
      controller.enqueue(part);
    },
    flush(controller) {
      finishChannels(controller);
    }
  }));
}

function wrapLanguageModel(model) {
  if (!model || typeof model !== 'object') return model;
  return new Proxy(model, {
    get(target, property, receiver) {
      if (property === 'doGenerate') {
        return async options => transformDsmlGenerateResult(await target.doGenerate({
          ...options,
          prompt: normalizeDsmlPrompt(options?.prompt)
        }));
      }
      if (property === 'doStream') {
        return async options => {
          const result = await target.doStream({
            ...options,
            prompt: normalizeDsmlPrompt(options?.prompt)
          });
          return { ...result, stream: transformDsmlStream(result.stream) };
        };
      }
      return Reflect.get(target, property, receiver);
    }
  });
}

export function createYanDsmlProvider(options) {
  const provider = createOpenAICompatible(options);
  return new Proxy(provider, {
    apply(target, thisArg, args) {
      return wrapLanguageModel(Reflect.apply(target, thisArg, args));
    },
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (!LANGUAGE_MODEL_METHODS.has(property) || typeof value !== 'function') return value;
      return (...args) => wrapLanguageModel(Reflect.apply(value, target, args));
    }
  });
}
