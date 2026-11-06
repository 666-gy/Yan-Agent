class VoicePcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(2048);
    this.offset = 0;
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    if (input) {
      for (let index = 0; index < input.length; index++) {
        this.buffer[this.offset++] = input[index];
        if (this.offset === this.buffer.length) {
          this.port.postMessage(this.buffer, [this.buffer.buffer]);
          this.buffer = new Float32Array(2048);
          this.offset = 0;
        }
      }
    }
    outputs[0]?.[0]?.fill(0);
    return true;
  }
}

registerProcessor('yan-voice-pcm', VoicePcmProcessor);
