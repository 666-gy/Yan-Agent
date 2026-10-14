import { vendorChatProvider } from './vendor-chat-provider.mjs';
import { shapeGemlRequestBody } from './vendor-request-shaping.mjs';

export function createYanGemlProvider(options = {}) {
  return vendorChatProvider(options, { name: 'google', shape: shapeGemlRequestBody, googleSignatures: true });
}
