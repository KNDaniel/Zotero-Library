/**
 * Vigilante del hilo principal: detecta cuándo un temporizador llega mucho más tarde de lo debido.
 * Si la ventana está oculta o minimizada, Chromium frena los temporizadores y el retraso no es un
 * bloqueo del plugin: no se avisa ni mientras está oculta ni en el primer aviso al volver.
 */
export interface Watchdog {
  tick(now?: number): void;
  /** Llamar cuando la ventana pasa a estar oculta (visibilitychange) */
  markHidden(): void;
}

export function createWatchdog(opts: { periodMs: number; thresholdMs: number; isHidden: () => boolean; log: (message: string) => void }): Watchdog {
  let last = Date.now();
  let skipNext = false;
  return {
    tick(now = Date.now()) {
      const hidden = opts.isHidden();
      const skip = hidden || skipNext;
      skipNext = hidden;
      const blocked = now - last - opts.periodMs;
      last = now;
      if (!skip && blocked > opts.thresholdMs) opts.log(`el hilo principal estuvo bloqueado unos ${blocked} ms`);
    },
    markHidden() {
      skipNext = true;
    },
  };
}
