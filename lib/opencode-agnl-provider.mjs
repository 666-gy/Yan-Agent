import { vendorChatProvider } from './vendor-chat-provider.mjs';
import { shapeAgnlRequestBody, normalizeAgnlPayload } from './vendor-request-shaping.mjs';

export function createYanAgnlProvider(options = {}) {
  return vendorChatProvider(options, { name: 'agnes', shape: shapeAgnlRequestBody, normalizePayload: normalizeAgnlPayload });
}
