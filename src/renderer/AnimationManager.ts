import { framePaths, manifest } from '../shared/manifest';
import { ANIMATIONS } from '../shared/types';
import type { AnimationName, PetSnapshot } from '../shared/types';

/** 全部 64 帧在显示角色前完成 decode；切换动作时不再请求或解码图片。 */
export class AnimationManager {
  private cache = new Map<AnimationName, HTMLImageElement[]>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private generation = 0;
  private animation: AnimationName | null = null;
  private frame = 0;
  private paused = false;

  async preload(): Promise<void> {
    await Promise.all(ANIMATIONS.map(async animation => {
      const images = await Promise.all(framePaths(animation).map(async path => {
        const image = new Image();
        image.src = path;
        try { await image.decode(); }
        catch { throw new Error(`动画图片无法载入：${path}`); }
        return image;
      }));
      if (!this.disposed) this.cache.set(animation, images);
    }));
  }
  play(state: PetSnapshot, draw: (frame: HTMLImageElement) => void, complete: (revision: number) => void): void {
    this.stop();
    const token = this.generation;
    const frames = this.cache.get(state.animation);
    if (this.disposed || !frames?.length) return;
    const entry = manifest.animations[state.animation];
    let index = state.animation === this.animation && state.paused !== this.paused ? this.frame : 0;
    this.animation = state.animation;
    this.paused = state.paused;
    this.frame = index;
    draw(frames[index]);
    if (state.paused) return;
    const tick = () => {
      if (this.disposed || token !== this.generation) return;
      index++;
      if (index >= frames.length) {
        if (!entry.loop) { this.timer = undefined; complete(state.revision); return; }
        index = 0;
      }
      this.frame = index;
      draw(frames[index]);
      this.timer = setTimeout(tick, entry.intervalMs);
    };
    this.timer = setTimeout(tick, entry.intervalMs);
  }
  stop(): void { clearTimeout(this.timer); this.timer = undefined; this.generation++; }
  dispose(): void { this.disposed = true; this.stop(); this.cache.clear(); }
}
