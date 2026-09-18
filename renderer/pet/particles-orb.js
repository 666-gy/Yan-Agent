(() => {
  'use strict';

  // Adapted from VoiceOrbs Particles Orb (MIT). See THIRD_PARTY_LICENSES.txt.

  const PARTICLE_COUNT = 720;
  const TWO_PI = Math.PI * 2;
  const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
  const ERROR_FROM = [251, 113, 133];
  const ERROR_TO = [244, 63, 94];
  const STATE_MOTION = {
    idle: 'none',
    connecting: 'none',
    listening: 'ripple',
    thinking: 'pulse',
    speaking: 'flow',
    error: 'none',
    disabled: 'none'
  };

  const clamp01 = value => Math.min(1, Math.max(0, Number(value) || 0));
  const approach = (current, target, rate, dt) => (
    current + (target - current) * (1 - Math.exp(-rate * dt))
  );

  function hexToRgb(value) {
    const clean = String(value || '').replace('#', '');
    const full = clean.length === 3 ? clean.split('').map(char => char + char).join('') : clean;
    const number = Number.parseInt(full, 16);
    if (!Number.isFinite(number)) return [255, 255, 255];
    return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
  }

  function mixRgb(a, b, amount) {
    return [
      a[0] + (b[0] - a[0]) * amount,
      a[1] + (b[1] - a[1]) * amount,
      a[2] + (b[2] - a[2]) * amount
    ];
  }

  function buildSphere(count) {
    const points = [];
    for (let index = 0; index < count; index += 1) {
      const y = 1 - (index / (count - 1)) * 2;
      const radiusAtY = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = GOLDEN_ANGLE * index;
      points.push({
        x: Math.cos(theta) * radiusAtY,
        y,
        z: Math.sin(theta) * radiusAtY,
        ringFrac: (index * 0.61803398875) % 1,
        seed: ((index * 0.7548776662) % 1) * TWO_PI,
        tone: (index * 0.5436890126) % 1
      });
    }
    return points;
  }

  function energyForState(state, time) {
    if (state === 'listening') return 0.4 + 0.32 * Math.abs(Math.sin(time * 8.5)) + 0.18 * Math.abs(Math.sin(time * 4.1 + 1.5));
    if (state === 'speaking') return 0.3 + 0.24 * Math.abs(Math.sin(time * 6.2)) + 0.16 * Math.abs(Math.sin(time * 3 + 0.6));
    if (state === 'thinking') return 0.24 + 0.2 * Math.abs(Math.sin(time * 2.4));
    if (state === 'connecting') return 0.12 + 0.1 * Math.abs(Math.sin(time * 1.6));
    if (state === 'error') return 0.2;
    return 0;
  }

  class ParticlesOrb {
    constructor(canvas, options = {}) {
      this.canvas = canvas;
      this.ctx = canvas?.getContext('2d');
      this.size = Number(options.size) || 212;
      this.speed = Number(options.speed) || 2;
      this.state = options.state || 'idle';
      this.colorFrom = options.colorFrom || '#f0abfc';
      this.colorTo = options.colorTo || '#818cf8';
      this.points = buildSphere(PARTICLE_COUNT);
      this.weights = Object.fromEntries(Object.keys(STATE_MOTION).map(key => [key, key === this.state ? 1 : 0]));
      this.level = 0;
      this.manualLevel = null;
      this.time = 0;
      this.angleY = 0;
      this.connectingPhase = 0;
      this.last = null;
      this.raf = 0;
      this.running = true;
      this.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
      this.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      this.resize();
      this.onVisibility = () => {
        this.running = !document.hidden;
        if (this.running) this.wake();
        else this.halt();
      };
      document.addEventListener('visibilitychange', this.onVisibility);
      if (this.reducedMotion) this.render(0, true);
      else this.wake();
    }

    resize() {
      if (!this.ctx || !this.canvas) return;
      this.canvas.width = Math.round(this.size * this.dpr);
      this.canvas.height = Math.round(this.size * this.dpr);
      this.canvas.style.width = `${this.size}px`;
      this.canvas.style.height = `${this.size}px`;
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }

    setState(state) {
      this.state = STATE_MOTION[state] ? state : 'idle';
      if (this.reducedMotion) this.render(0, true);
    }

    setLevel(level) {
      const numeric = Number(level);
      this.manualLevel = level === null || level === undefined || !Number.isFinite(numeric) || numeric < 0
        ? null
        : clamp01(numeric);
    }

    updateWeights(dt) {
      let total = 0;
      for (const key of Object.keys(this.weights)) {
        const target = key === this.state ? 1 : 0;
        const next = approach(this.weights[key], target, 6, dt);
        this.weights[key] = target === 0 && next < 0.001 ? 0 : next;
        total += this.weights[key];
      }
      if (total > 0) {
        for (const key of Object.keys(this.weights)) this.weights[key] /= total;
      }
      return this.weights;
    }

    render(dt, isStatic = false) {
      if (!this.ctx) return;
      const easeDt = isStatic ? 60 : dt;
      const weights = this.updateWeights(easeDt);
      const ripple = weights.listening;
      const pulse = weights.thinking;
      const flow = weights.speaking;
      const disabled = weights.disabled;
      const error = weights.error;
      const motionScale = 1 - disabled * 0.96;
      const rawLevel = this.manualLevel === null ? energyForState(this.state, this.time) : this.manualLevel;
      const level = this.level = approach(this.level, rawLevel, 9, easeDt);
      const spin = (0.14 + ripple * (0.9 + level * 1.6) + flow * 0.4 + weights.connecting * 0.3) * motionScale;
      this.angleY += dt * this.speed * spin;
      this.connectingPhase = (this.connectingPhase + dt * this.speed * 1.1) % TWO_PI;
      this.time += dt;

      const idleBreathe = 0.05 * (0.25 + weights.idle * 0.75) * Math.sin(this.time * 1.1 * this.speed) * motionScale;
      const pulseScale = pulse * (0.22 + 0.12 * Math.sin(this.time * 2.6 * this.speed + 1));
      const flowExpand = flow * (0.08 + level * 0.32);
      const center = this.size / 2;
      const baseRadius = center * 0.62;
      const radius = baseRadius * (1 + idleBreathe + level * 0.16 + flowExpand - pulseScale);
      const from = mixRgb(hexToRgb(this.colorFrom), ERROR_FROM, error);
      const to = mixRgb(hexToRgb(this.colorTo), ERROR_TO, error);
      const shakeAmp = error * radius * 0.05 * motionScale;
      const shakeX = shakeAmp * (Math.sin(this.time * 26 * this.speed) + 0.5 * Math.sin(this.time * 15.7 * this.speed));
      const shakeY = shakeAmp * (Math.cos(this.time * 22.5 * this.speed) + 0.5 * Math.sin(this.time * 13.1 * this.speed));
      const idleAmp = weights.idle * radius * 0.055 * motionScale;
      const jitterAmp = (flow + error * 0.7) * radius * (0.015 + level * 0.085) * motionScale;
      const rippleAmp = ripple * (0.045 + level * 0.24);
      const pulseAmp = pulse * 0.16;
      const alphaScale = 1 - disabled * 0.35;
      const cosY = Math.cos(this.angleY);
      const sinY = Math.sin(this.angleY);
      const cosX = Math.cos(0.32);
      const sinX = Math.sin(0.32);

      this.ctx.clearRect(0, 0, this.size, this.size);
      this.ctx.globalCompositeOperation = !isStatic && ripple + pulse + flow > 0.5 ? 'lighter' : 'source-over';
      for (let index = 0; index < this.points.length; index += 1) {
        const point = this.points[index];
        const x1 = point.x * cosY - point.z * sinY;
        const z1 = point.x * sinY + point.z * cosY;
        const y1 = point.y * cosX - z1 * sinX;
        const z2 = point.y * sinX + z1 * cosX;
        const depth = (z2 + 1) / 2;
        const perspective = 0.65 + depth * 0.45;
        let pointRadius = radius;
        if (rippleAmp > 0.002) pointRadius *= 1 + rippleAmp * Math.sin(point.y * 4.5 - this.time * 6.5 * this.speed);
        if (pulseAmp > 0.002) pointRadius *= 1 - pulseAmp * (0.5 + 0.5 * Math.sin(point.ringFrac * TWO_PI + this.time * 3.1 * this.speed));
        let offsetX = shakeX;
        let offsetY = shakeY;
        if (idleAmp > 0.01) {
          offsetX += idleAmp * (Math.sin(this.time * 0.55 * this.speed + point.seed * 3.7) + 0.5 * Math.sin(this.time * 1.3 * this.speed + point.seed * 1.3));
          offsetY += idleAmp * (Math.cos(this.time * 0.62 * this.speed + point.seed * 2.9) + 0.5 * Math.sin(this.time * 1.05 * this.speed + point.seed * 5.1));
        }
        if (jitterAmp > 0.01) {
          offsetX += jitterAmp * Math.sin(this.time * 14 * this.speed + point.seed * 9.3);
          offsetY += jitterAmp * Math.cos(this.time * 17 * this.speed + point.seed * 6.1);
        }
        const sphereX = center + x1 * pointRadius * perspective + offsetX;
        const sphereY = center + y1 * pointRadius * perspective + offsetY;
        const sphereAlpha = (0.12 + depth * depth * 0.78) * alphaScale;
        const sphereDot = 0.6 + depth * 1.5;
        let screenX = sphereX;
        let screenY = sphereY;
        let alpha = sphereAlpha;
        let dot = sphereDot;
        if (weights.connecting > 0.004) {
          const base = (index / this.points.length) * TWO_PI;
          const jitter = 0.05 * Math.sin(this.time * 1.3 + point.seed);
          const ringAngle = base + this.connectingPhase + jitter;
          const ringRadius = center * (0.58 + 0.13 * point.ringFrac) * (1 + 0.05 * Math.sin(this.time + point.seed * 1.7));
          const circleX = center + Math.cos(ringAngle) * ringRadius;
          const circleY = center + Math.sin(ringAngle) * ringRadius;
          const ringAlpha = 0.35 + point.tone * 0.5;
          const ringDot = 0.75 + point.tone * 0.9;
          screenX = sphereX + (circleX - sphereX) * weights.connecting;
          screenY = sphereY + (circleY - sphereY) * weights.connecting;
          alpha = sphereAlpha + (ringAlpha - sphereAlpha) * weights.connecting;
          dot = sphereDot + (ringDot - sphereDot) * weights.connecting;
        }
        const red = from[0] + (to[0] - from[0]) * point.tone;
        const green = from[1] + (to[1] - from[1]) * point.tone;
        const blue = from[2] + (to[2] - from[2]) * point.tone;
        this.ctx.beginPath();
        this.ctx.fillStyle = `rgba(${red | 0}, ${green | 0}, ${blue | 0}, ${alpha.toFixed(3)})`;
        this.ctx.arc(screenX, screenY, dot, 0, TWO_PI);
        this.ctx.fill();
      }
      this.ctx.globalCompositeOperation = 'source-over';
    }

    wake() {
      if (this.reducedMotion || this.raf !== 0 || !this.running) return;
      this.last = null;
      this.raf = requestAnimationFrame(now => this.frame(now));
    }

    halt() {
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.last = null;
    }

    frame(now) {
      this.raf = 0;
      const dt = this.last === null ? 0 : Math.min((now - this.last) / 1000, 0.1);
      this.last = now;
      this.render(dt);
      if (this.running) this.raf = requestAnimationFrame(next => this.frame(next));
    }

    destroy() {
      this.halt();
      document.removeEventListener('visibilitychange', this.onVisibility);
    }
  }

  window.yanParticlesOrb = { ParticlesOrb };
})();
