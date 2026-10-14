var YanVoiceAudio = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // lib/vendor/dsh-voice/client/audio.ts
  var audio_exports = {};
  __export(audio_exports, {
    Recording: () => Recording,
    RecordingError: () => RecordingError,
    audioBase64: () => audioBase64,
    encodeWave: () => encodeWave
  });
  var RecordingError = class extends Error {
    constructor(kind) {
      super(kind);
      this.kind = kind;
      this.name = "RecordingError";
    }
  };
  function encodeWave(samples) {
    const bytes = new Uint8Array(44 + samples.length * 2);
    const view = new DataView(bytes.buffer);
    const text = (at, value) => {
      for (let i = 0; i < value.length; i++) bytes[at + i] = value.charCodeAt(i);
    };
    text(0, "RIFF");
    view.setUint32(4, bytes.length - 8, true);
    text(8, "WAVE");
    text(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 16e3, true);
    view.setUint32(28, 32e3, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    text(36, "data");
    view.setUint32(40, samples.length * 2, true);
    for (const [i, sample] of samples.entries()) {
      const value = Math.max(-1, Math.min(1, sample));
      view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
    }
    return bytes;
  }
  function audioBase64(bytes) {
    let text = "";
    for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(text);
  }
  var Recording = class {
    constructor(onDispose) {
      this.onDispose = onDispose;
    }
    stream;
    recorder;
    context;
    analyser;
    samples = new Float32Array(256);
    chunks = [];
    pcmChunks = [];
    pcmRead = 0;
    sourceNode;
    processor;
    sampleRate = 48e3;
    lifetime = new AbortController();
    disposal;
    /**
     * Acquire the microphone for this recording.
     * @param onError - receives failures during capture, before asynchronous resource release finishes.
     * @returns after capture starts; a cancelled permission grant immediately releases its tracks.
     */
    async start(onError) {
      const devices = navigator.mediaDevices;
      if (!devices || typeof MediaRecorder === "undefined") throw new RecordingError("unavailable");
      let stream;
      try {
        stream = await devices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      } catch (error) {
        if (error instanceof DOMException && error.name === "NotAllowedError") throw new RecordingError("permission");
        throw error;
      }
      if (this.lifetime.signal.aborted) {
        stream.getTracks().forEach((track) => {
          track.stop();
        });
        throw new RecordingError("cancelled");
      }
      this.stream = stream;
      try {
        this.context = new AudioContext();
        this.sampleRate = this.context.sampleRate;
        this.analyser = this.context.createAnalyser();
        this.analyser.fftSize = this.samples.length;
        this.sourceNode = this.context.createMediaStreamSource(stream);
        this.sourceNode.connect(this.analyser);
        await this.context.audioWorklet.addModule(new URL("vendor/dsh-voice/pcm-worklet.js", document.baseURI).href);
        if (this.lifetime.signal.aborted) throw new RecordingError("cancelled");
        this.processor = new AudioWorkletNode(this.context, "yan-voice-pcm", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
        this.processor.port.onmessage = (event) => {
          if (!this.lifetime.signal.aborted && event.data instanceof Float32Array) this.pcmChunks.push(event.data);
        };
        this.sourceNode.connect(this.processor);
        this.processor.connect(this.context.destination);
        this.recorder = new MediaRecorder(stream);
        this.recorder.ondataavailable = (event) => {
          if (!this.lifetime.signal.aborted && event.data.size > 0) this.chunks.push(event.data);
        };
        this.recorder.onerror = () => {
          if (this.lifetime.signal.aborted) return;
          void this.dispose().catch(() => void 0);
          try {
            onError?.(new RecordingError("interrupted"));
          } catch (error) {
            console.error("Speech recording error handler failed", error);
          }
        };
        this.recorder.start();
      } catch (error) {
        await this.dispose();
        throw error;
      }
    }
    /**
     * Read the live microphone signal.
     * @returns the measured RMS level, or zero outside capture.
     */
    amplitude() {
      if (!this.analyser) return 0;
      this.analyser.getFloatTimeDomainData(this.samples);
      let sum = 0;
      for (const sample of this.samples) sum += sample * sample;
      return Math.sqrt(sum / this.samples.length);
    }
    /** Return a current PCM snapshot for best-effort interim recognition. */
    async snapshot(maxDurationSeconds) {
      const count = this.pcmChunks.reduce((total, chunk) => total + chunk.length, 0);
      if (!count) throw new RecordingError("empty");
      const input = new Float32Array(Math.min(count, Math.floor(maxDurationSeconds * this.sampleRate)));
      let offset = 0;
      for (const chunk of this.pcmChunks) {
        if (offset >= input.length) break;
        const size = Math.min(chunk.length, input.length - offset);
        input.set(chunk.subarray(0, size), offset);
        offset += size;
      }
      const ratio = this.sampleRate / 16e3;
      const output = new Float32Array(Math.max(1, Math.floor(input.length / ratio)));
      for (let i = 0; i < output.length; i++) output[i] = input[Math.min(input.length - 1, Math.floor(i * ratio))];
      return encodeWave(output);
    }
    /** Return newly captured 16 kHz PCM bytes since the previous stream read. */
    async readPcmChunk() {
      const count = this.pcmChunks.reduce((total, chunk) => total + chunk.length, 0);
      if (count <= this.pcmRead) return new Uint8Array(new ArrayBuffer(0));
      const input = new Float32Array(count - this.pcmRead);
      let offset = 0, seen = 0;
      for (const chunk of this.pcmChunks) {
        const start = Math.max(0, this.pcmRead - seen);
        if (start < chunk.length) {
          input.set(chunk.subarray(start), offset);
          offset += chunk.length - start;
        }
        seen += chunk.length;
      }
      this.pcmRead = count;
      const ratio = this.sampleRate / 16e3;
      const output = new Float32Array(Math.max(1, Math.floor(input.length / ratio)));
      for (let i = 0; i < output.length; i++) output[i] = input[Math.min(input.length - 1, Math.floor(i * ratio))];
      return new Uint8Array(output.buffer);
    }
    /**
     * Finish capture and resample the recording.
     * @param maxDurationSeconds - truncate timer overshoot to the Host limit.
     * @returns one recording after the final MediaRecorder chunk arrives.
     */
    async stop(maxDurationSeconds) {
      const recorder = this.recorder;
      const context = this.context;
      if (!recorder || !context || recorder.state !== "recording") {
        await this.dispose();
        throw new RecordingError("empty");
      }
      try {
        await new Promise((resolve, reject) => {
          recorder.onstop = () => {
            resolve();
          };
          recorder.onerror = () => {
            reject(new RecordingError("empty"));
          };
          recorder.stop();
        });
        this.stream?.getTracks().forEach((track) => {
          track.stop();
        });
        this.lifetime.signal.throwIfAborted();
        const blob = new Blob(this.chunks, { type: recorder.mimeType });
        if (blob.size === 0) throw new RecordingError("empty");
        const decoded = await context.decodeAudioData(await blob.arrayBuffer());
        this.lifetime.signal.throwIfAborted();
        const offline = new OfflineAudioContext(1, Math.max(1, Math.floor(Math.min(decoded.duration, maxDurationSeconds) * 16e3)), 16e3);
        const source = offline.createBufferSource();
        source.buffer = decoded;
        source.connect(offline.destination);
        source.start();
        const resampled = await offline.startRendering();
        this.lifetime.signal.throwIfAborted();
        return encodeWave(resampled.getChannelData(0));
      } finally {
        await this.dispose();
      }
    }
    /**
     * Release this recording and invalidate pending permission grants.
     * @returns the shared release promise, including any AudioContext close failure.
     */
    dispose() {
      if (!this.disposal) {
        const closing = Promise.withResolvers();
        this.disposal = closing.promise;
        void this.release().then(closing.resolve, closing.reject);
      }
      return this.disposal;
    }
    async release() {
      this.lifetime.abort(new RecordingError("cancelled"));
      if (this.recorder?.state === "recording") this.recorder.stop();
      this.stream?.getTracks().forEach((track) => {
        track.stop();
      });
      this.stream = void 0;
      const context = this.context;
      this.context = void 0;
      this.analyser = void 0;
      this.sourceNode?.disconnect();
      this.sourceNode = void 0;
      if (this.processor) {
        this.processor.port.onmessage = null;
        this.processor.disconnect();
      }
      this.processor = void 0;
      this.chunks = [];
      this.pcmChunks = [];
      this.pcmRead = 0;
      try {
        if (context && context.state !== "closed") await context.close();
      } finally {
        this.onDispose();
      }
    }
  };
  return __toCommonJS(audio_exports);
})();
