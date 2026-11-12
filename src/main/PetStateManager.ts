import { manifest } from '../shared/manifest';
import type { AnimationName, Emotion, PetActivity, PetActivityEvent, PetSnapshot } from '../shared/types';

const activityAnimation: Record<PetActivity, AnimationName> = {
  idle: 'idle', thinking: 'thinking', responding: 'thinking', working: 'working',
  waitingApproval: 'question', success: 'happy',
};
const priorities: Record<PetActivity, number> = {
  idle: 0, thinking: 60, responding: 60, working: 70, waitingApproval: 80, success: 40,
};

/** 主进程内唯一动画状态入口。Renderer 只接受快照和报告一轮播放完成。 */
export class PetStateManager {
  private activity: PetActivity = 'idle';
  private sourceActivities = new Map<PetActivityEvent['source'], PetActivity>();
  private dragging = false;
  private sleeping = false;
  private emotion: Emotion | null = null;
  private preview: AnimationName | null = null;
  private paused = false;
  private revision = 0;
  private lastInteraction = Date.now();
  private sleepTimer: ReturnType<typeof setTimeout> | undefined;
  private listeners = new Set<() => void>();
  private previous = '';

  constructor(private sleepAfterMs = 300_000) { this.armSleep(); }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  snapshot(): PetSnapshot {
    let animation: AnimationName = activityAnimation[this.activity];
    let priority = priorities[this.activity];
    if (this.sleeping && this.activity === 'idle') { animation = 'sleeping'; priority = 10; }
    if (this.emotion && priority < 40) { animation = this.emotion; priority = 40; }
    if (this.preview) { animation = this.preview; priority = 90; }
    if (this.dragging) { animation = 'dragged'; priority = 100; }
    return { animation, activity: this.activity, revision: this.revision, paused: this.paused, priority };
  }
  private notify(force = false): void {
    const { revision: _, ...state } = this.snapshot();
    const signature = JSON.stringify(state);
    if (force || signature !== this.previous) {
      this.previous = signature;
      this.revision++;
      for (const listener of this.listeners) listener();
    }
  }
  wake(): void {
    this.lastInteraction = Date.now();
    this.sleeping = false;
    this.armSleep();
    this.notify();
  }
  setPetActivity(activity: PetActivity): void {
    this.sourceActivities.clear();
    this.applyActivity(activity);
  }
  private applyActivity(activity: PetActivity): void {
    this.activity = activity;
    this.emotion = null;
    this.sleeping = false;
    this.preview = null;
    this.lastInteraction = Date.now();
    this.armSleep();
    this.notify(activity === 'success');
  }
  handleActivityEvent(event: PetActivityEvent): void {
    this.sourceActivities.set(event.source, event.activity);
    const next = [...this.sourceActivities.values()].reduce<PetActivity>((best, value) =>
      priorities[value] > priorities[best] ? value : best, 'idle');
    this.applyActivity(next);
  }
  setDragging(dragging: boolean): void {
    this.wake();
    this.dragging = dragging;
    this.preview = null;
    this.emotion = null;
    // 按 MVP 交互约定，松开拖动回到 idle；后续真实任务事件可再次驱动状态。
    if (!dragging) { this.activity = 'idle'; this.sourceActivities.clear(); }
    this.notify();
  }
  interact(emotion: Emotion): void {
    this.wake();
    if (priorities[this.activity] >= 40 || this.dragging) return;
    this.preview = null;
    this.emotion = emotion;
    this.notify(true);
  }
  animationFinished(revision: number): void {
    const current = this.snapshot();
    if (revision !== current.revision || this.paused || manifest.animations[current.animation].loop) return;
    if (this.preview) this.preview = null;
    else {
      this.emotion = null;
      if (this.activity === 'success') { this.activity = 'idle'; this.sourceActivities.clear(); }
    }
    this.notify();
  }
  setPaused(paused: boolean): void { this.paused = paused; this.notify(); }
  setSleepAfter(ms: number): void { this.sleepAfterMs = ms; this.armSleep(); }
  previewAnimation(animation: AnimationName): void { this.wake(); this.preview = animation; this.notify(true); }
  stopPreview(): void { this.preview = null; this.setPetActivity('idle'); }
  private armSleep(): void {
    clearTimeout(this.sleepTimer);
    if (this.sleepAfterMs === 0) return;
    const delay = Math.max(1, this.sleepAfterMs - (Date.now() - this.lastInteraction));
    this.sleepTimer = setTimeout(() => {
      if (this.activity === 'idle' && !this.dragging && !this.preview) {
        this.emotion = null;
        this.sleeping = true;
        this.notify();
      }
    }, delay);
    this.sleepTimer.unref?.();
  }
  dispose(): void { clearTimeout(this.sleepTimer); this.listeners.clear(); }
}
