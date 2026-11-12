import { spawn } from 'node:child_process';
import { electronEnvironment, electronPath } from './electron.mjs';
const child = spawn(electronPath, ['.'], { env: electronEnvironment(), stdio: 'inherit' });
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
