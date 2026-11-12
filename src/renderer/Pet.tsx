import { useEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { AnimationManager } from './AnimationManager';
import { useSnapshot } from './useSnapshot';

export function Pet() {
  const { snapshot, error: ipcError } = useSnapshot();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const manager = useRef<AnimationManager | null>(null);
  const press = useRef<number | null>(null);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastClick = useRef(0);
  useEffect(() => {
    const player = new AnimationManager();
    manager.current = player;
    let live = true;
    player.preload().then(() => { if (live) setReady(true); }).catch(error => { if (live) setError(String(error)); });
    return () => { live = false; player.dispose(); clearTimeout(clickTimer.current); };
  }, []);
  useEffect(() => {
    if (!ready || !snapshot || !manager.current) return;
    const player = manager.current;
    player.play(snapshot.pet, image => {
      const context = canvas.current?.getContext('2d');
      if (!context) return;
      // 在同一次绘制中替换整帧；不使用 img.src 反复触发解码。
      context.clearRect(0, 0, 443, 443);
      context.drawImage(image, 0, 0, 443, 443);
    }, revision => { void window.desktopPet.animationFinished(revision).catch(error => setError(String(error))); });
    return () => player.stop();
  }, [ready, snapshot?.pet.animation, snapshot?.pet.revision, snapshot?.pet.paused]);
  async function pointerDown(event: PointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0 || press.current !== null) return;
    event.preventDefault();
    clearTimeout(clickTimer.current);
    press.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    try { await window.desktopPet.beginDrag({ x: event.clientX, y: event.clientY }); } catch (error) { press.current = null; setError(String(error)); }
  }
  async function pointerUp(event: PointerEvent<HTMLCanvasElement>, cancelled = false) {
    if (press.current !== event.pointerId) return;
    press.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    try {
      const { dragged } = await window.desktopPet.endDrag();
      if (cancelled || dragged) { lastClick.current = 0; return; }
      const now = performance.now();
      if (now - lastClick.current < 450) {
        clearTimeout(clickTimer.current); lastClick.current = 0;
        await window.desktopPet.openPanel('chat');
      } else {
        lastClick.current = now;
        clickTimer.current = setTimeout(() => {
          lastClick.current = 0;
          void window.desktopPet.interact('happy').catch(error => setError(String(error)));
        }, 450);
      }
    } catch (error) { setError(String(error)); }
  }
  return <div className="pet-surface">
    <canvas ref={canvas} width={443} height={443} className="pet-canvas" role="button" tabIndex={0}
      aria-label="艾玛桌宠，单击互动，双击聊天，按住拖动，右键菜单"
      data-animation={snapshot?.pet.animation} data-revision={snapshot?.pet.revision} data-ready={ready}
      onPointerDown={pointerDown} onPointerUp={event => void pointerUp(event)}
      onPointerCancel={event => void pointerUp(event, true)} onLostPointerCapture={event => void pointerUp(event, true)}
      onContextMenu={event => { event.preventDefault(); clearTimeout(clickTimer.current); void window.desktopPet.showContextMenu().catch(error => setError(String(error))); }}
      onKeyDown={event => {
        if (event.key === 'Enter') void window.desktopPet.openPanel('chat');
        if (event.key === ' ') { event.preventDefault(); void window.desktopPet.interact('happy'); }
      }} />
    {(error || ipcError) && <div className="pet-error" role="alert">{error || ipcError}</div>}
  </div>;
}
