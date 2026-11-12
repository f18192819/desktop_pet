export interface Rect { x: number; y: number; width: number; height: number }
export function fitToDisplays(position: { x: number; y: number } | null, size: number, areas: Rect[]): Rect {
  if (!areas.length) throw new Error('未检测到显示器');
  const origin = position ?? { x: areas[0].x + areas[0].width - size - 32, y: areas[0].y + areas[0].height - size - 32 };
  // 选择距离角色中心最近的工作区；支持左侧屏幕的负坐标和屏幕之间的空隙。
  const center = { x: origin.x + size / 2, y: origin.y + size / 2 };
  const distance = (a: Rect) => Math.hypot(Math.max(a.x - center.x, 0, center.x - a.x - a.width), Math.max(a.y - center.y, 0, center.y - a.y - a.height));
  const area = areas.reduce((best, a) => distance(a) < distance(best) ? a : best);
  const actualSize = Math.min(size, area.width, area.height);
  return {
    x: Math.round(Math.min(Math.max(origin.x, area.x), area.x + area.width - actualSize)),
    y: Math.round(Math.min(Math.max(origin.y, area.y), area.y + area.height - actualSize)),
    width: actualSize, height: actualSize,
  };
}
