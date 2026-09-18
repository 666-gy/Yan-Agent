'use strict';

// A successful HTTP handshake is not a recovered stream. Only sustained
// useful traffic replenishes the budget; repeated immediate EOFs exhaust it.
class StreamReconnectBudget {
  constructor({ limit = 5, stableMs = 30000, now = Date.now } = {}) {
    this.limit = limit;
    this.stableMs = stableMs;
    this.now = now;
    this.used = 0;
    this.connectedAt = now();
  }
  connected() { this.connectedAt = this.now(); }
  progress() {
    if (this.now() - this.connectedAt >= this.stableMs) this.used = 0;
  }
  take() {
    if (this.used >= this.limit) return false;
    this.used++;
    return true;
  }
}

module.exports = { StreamReconnectBudget };
