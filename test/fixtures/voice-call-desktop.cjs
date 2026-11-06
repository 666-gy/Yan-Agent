require('electron').app.commandLine.appendSwitch('use-fake-device-for-media-stream');
require('electron').app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
// Isolated desktop test: model readiness is simulated, no model download or audio capture.
const voice = require('../../lib/voice-input');
const original = voice.createVoiceInput;
voice.createVoiceInput = options => {
 const service = original(options);
 service.warmup = async () => {};
 const status = service.status;
 service.status = async () => { const value = await status(); return { ...value, ready: true, preferences: { ...value.preferences, callEnabled: true } }; };
 return service;
};
const speech = require('../../lib/voice-call-speech');
speech.createVoiceCallSpeech = () => ({ warmup: async () => {}, synthesize: async () => ({ audio: Buffer.alloc(44), mime: 'audio/wav' }), dispose() {}, cancel() {} });
require('../../main');
