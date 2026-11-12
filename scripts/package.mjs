import { cp, mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { electronPath } from './electron.mjs';
import { readFile } from 'node:fs/promises';

if (process.platform !== 'win32') throw new Error('请在 Windows 上构建便携版。');
const target = resolve(`release/emma-desktop-pet-win32-${process.arch}`);
await mkdir(target, { recursive: true });
await cp(dirname(electronPath), target, { recursive: true });
await rename(resolve(target, 'electron.exe'), resolve(target, 'Emma.exe'));
const appDir = resolve(target, 'resources/app');
await mkdir(appDir, { recursive: true });
await cp('dist', resolve(appDir, 'dist'), { recursive: true });
const sourcePackage = JSON.parse(await readFile('package.json', 'utf8'));
await writeFile(resolve(appDir, 'package.json'), JSON.stringify({
  name: 'emma-desktop-companion', productName: 'Emma Desktop Companion',
  version: sourcePackage.version, main: 'dist/electron/main.cjs',
}, null, 2));
console.log(`便携版：${target}/Emma.exe（请保留整个目录）`);
