import { vendorChatProvider } from './vendor-chat-provider.mjs';
import { shapeGrolRequestBody } from './vendor-request-shaping.mjs';

export function createYanGrolProvider(options = {}) {
  return vendorChatProvider(options, { name: 'grok', shape: shapeGrolRequestBody });
}
