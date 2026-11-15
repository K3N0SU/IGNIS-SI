import { useSyncExternalStore } from "react";

/**
 * Playback clock shared by the 3D twin, the chart cursors and the readouts.
 *
 * The clock lives outside React so that advancing it at display rate does not
 * re-render the component tree. Consumers either read `time` directly inside
 * their own animation loop or subscribe to the coarse sample index.
 */
class PlaybackClock {
  time = 0;
  duration = 1;
  dt = 0.1;
  playing = false;
  speed = 2;

  private listeners = new Set<() => void>();
  private frameListeners = new Set<(t: number) => void>();
  private raf = 0;
  private last = 0;
  private version = 0;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  onFrame(fn: (t: number) => void): () => void {
    this.frameListeners.add(fn);
    fn(this.time);
    return () => this.frameListeners.delete(fn);
  }

  getVersion = (): number => this.version;
  getIndex = (): number => Math.min(Math.round(this.time / this.dt), Math.round(this.duration / this.dt));

  private emit(): void {
    this.version += 1;
    this.listeners.forEach((fn) => fn());
  }

  private emitFrame(): void {
    this.frameListeners.forEach((fn) => fn(this.time));
  }

  load(duration: number, dt: number, keepTime: boolean): void {
    this.duration = Math.max(duration, dt);
    this.dt = dt;
    this.time = keepTime ? Math.min(this.time, this.duration) : 0;
    this.emit();
    this.emitFrame();
  }

  seek(t: number): void {
    const before = this.getIndex();
    this.time = Math.min(Math.max(t, 0), this.duration);
    this.emitFrame();
    if (this.getIndex() !== before) this.emit();
  }

  setSpeed(speed: number): void {
    this.speed = speed;
    this.emit();
  }

  play(): void {
    if (this.playing) return;
    if (this.time >= this.duration - 1e-6) this.time = 0;
    this.playing = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
    this.emit();
  }

  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.emit();
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  private tick = (now: number): void => {
    if (!this.playing) return;
    const elapsed = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    const before = this.getIndex();
    this.time = Math.min(this.time + elapsed * this.speed, this.duration);
    this.emitFrame();
    if (this.time >= this.duration) {
      this.playing = false;
      this.emit();
      return;
    }
    if (this.getIndex() !== before) this.emit();
    this.raf = requestAnimationFrame(this.tick);
  };
}

export const clock = new PlaybackClock();

/** Re-renders when the sample index, play state or speed changes. */
export function usePlayback(): { index: number; playing: boolean; speed: number; duration: number } {
  useSyncExternalStore(clock.subscribe, clock.getVersion, () => 0);
  return { index: clock.getIndex(), playing: clock.playing, speed: clock.speed, duration: clock.duration };
}
