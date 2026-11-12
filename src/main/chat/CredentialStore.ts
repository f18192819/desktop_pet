import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { atomicWrite } from './storage';
import { isRecord } from '../config';

export interface Encryption {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
  getSelectedStorageBackend?(): string;
}
/** 仅主进程可实例化，不向 UI 返回解密内容。端点绑定避免换地址后发送旧 Key。 */
export class CredentialStore {
  constructor(private file: string, private encryption: Encryption) {}
  available(): boolean {
    return this.encryption.isEncryptionAvailable() && this.encryption.getSelectedStorageBackend?.() !== 'basic_text';
  }
  hasKey(): boolean { return existsSync(this.file); }
  get(baseUrl: string): string {
    if (!this.hasKey()) return '';
    if (!this.available()) throw new Error('系统加密不可用，无法读取 API Key');
    try {
      const value: unknown = JSON.parse(this.encryption.decryptString(readFileSync(this.file)));
      if (!isRecord(value) || typeof value.key !== 'string' || value.baseUrl !== baseUrl) throw new Error();
      return value.key;
    } catch { throw new Error('API Key 无法解密或端点不匹配，请重新配置'); }
  }
  set(baseUrl: string, key: string): void {
    if (!key) { this.clear(); return; }
    if (!this.available()) throw new Error('系统加密不可用，禁止保存 API Key');
    try { atomicWrite(this.file, this.encryption.encryptString(JSON.stringify({ baseUrl, key }))); }
    catch { throw new Error('无法加密保存 API Key'); }
  }
  clear(): void { if (this.hasKey()) unlinkSync(this.file); }
}
