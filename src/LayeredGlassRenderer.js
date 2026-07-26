import { LayeredGlassComposer } from './LayeredGlassComposer.js';

/**
 * @deprecated Use LayeredGlassComposer instead.
 */
export class LayeredGlassRenderer extends LayeredGlassComposer {
  constructor(renderer, options = {}) {
    super(renderer, options);
    this.isLayeredGlassRenderer = true;
  }
}
