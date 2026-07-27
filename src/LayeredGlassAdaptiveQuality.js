function finiteNumber(value, fallback) {
  const resolved = Number(value);
  return Number.isFinite(resolved) ? resolved : fallback;
}

export class LayeredGlassAdaptiveQuality {
  constructor(composer, options = {}) {
    if (!composer?.setResolutionScale) {
      throw new TypeError(
        'LayeredGlassAdaptiveQuality requires a composer with setResolutionScale().',
      );
    }

    this.composer = composer;
    this.minScale = Math.min(
      1,
      Math.max(0.1, finiteNumber(options.minScale, 0.45)),
    );
    this.maxScale = Math.min(
      1,
      Math.max(this.minScale, finiteNumber(options.maxScale, 0.65)),
    );
    this.targetFrameTime = Math.max(
      8,
      finiteNumber(options.targetFrameTime, 1000 / 30),
    );
    this.adjustmentInterval = Math.max(
      250,
      finiteNumber(options.adjustmentInterval, 1200),
    );
    this.smoothing = Math.min(
      1,
      Math.max(0.01, finiteNumber(options.smoothing, 0.12)),
    );
    this.stepDown = Math.max(
      0.01,
      finiteNumber(options.stepDown, 0.05),
    );
    this.stepUp = Math.max(0.005, finiteNumber(options.stepUp, 0.025));
    this.downThreshold = Math.max(
      this.targetFrameTime,
      finiteNumber(options.downThreshold, this.targetFrameTime * 1.08),
    );
    this.upThreshold = Math.min(
      this.targetFrameTime,
      finiteNumber(options.upThreshold, this.targetFrameTime * 0.72),
    );

    this.scale = this._clampScale(
      finiteNumber(
        options.initialScale ?? composer.resolutionScale,
        this.minScale,
      ),
    );
    this.averageFrameTime = this.targetFrameTime;
    this.elapsedTime = 0;
    this.lastAdjustmentTime = -Infinity;
    this.composer.setResolutionScale(this.scale);
  }

  _clampScale(value) {
    return Math.min(
      this.maxScale,
      Math.max(this.minScale, finiteNumber(value, this.minScale)),
    );
  }

  update(frameTime, time) {
    const resolvedFrameTime = Number(frameTime);
    let resolvedTime = Number(time);
    if (
      !Number.isFinite(resolvedFrameTime)
      || resolvedFrameTime < 4
      || resolvedFrameTime > 250
    ) {
      return false;
    }

    if (time == null) {
      this.elapsedTime += resolvedFrameTime;
      resolvedTime = this.elapsedTime;
    } else if (Number.isFinite(resolvedTime)) {
      this.elapsedTime = resolvedTime;
    }

    this.averageFrameTime += (
      resolvedFrameTime - this.averageFrameTime
    ) * this.smoothing;

    if (
      !Number.isFinite(resolvedTime)
      || resolvedTime - this.lastAdjustmentTime < this.adjustmentInterval
    ) {
      return false;
    }

    let nextScale = this.scale;
    if (this.averageFrameTime > this.downThreshold) {
      nextScale -= this.stepDown;
    } else if (this.averageFrameTime < this.upThreshold) {
      nextScale += this.stepUp;
    } else {
      return false;
    }

    nextScale = Math.round(this._clampScale(nextScale) * 1000) / 1000;
    this.lastAdjustmentTime = resolvedTime;
    if (nextScale === this.scale) return false;

    this.scale = nextScale;
    this.composer.setResolutionScale(nextScale);
    return true;
  }

  reset(scale = this.scale) {
    this.scale = this._clampScale(Number(scale));
    this.averageFrameTime = this.targetFrameTime;
    this.elapsedTime = 0;
    this.lastAdjustmentTime = -Infinity;
    this.composer.setResolutionScale(this.scale);
    return this;
  }
}
