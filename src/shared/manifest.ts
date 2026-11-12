import manifest from '../../assets/characters/emma/animation-manifest.json';
import type { AnimationName } from './types';

export { manifest };
export function framePaths(animation: AnimationName): string[] {
  const entry = manifest.animations[animation];
  return Array.from({ length: entry.frameCount }, (_, index) =>
    `./characters/emma/${entry.directory}/${entry.framePattern.replace('{index}', String(index).padStart(2, '0'))}`);
}
