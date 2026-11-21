import { isAbsolute } from 'node:path';
import { PERMISSION_KEYS, WRITE_TOOLS } from '../../shared/agent';
import type { PermissionKey, PermissionMode, ToolPermissions } from '../../shared/agent';
import { readJSON } from '../chat/storage';
import { isRecord } from '../config';
import { isWorkspaceIdentity } from './WorkspaceSecurity';

export const WORKSPACE_CONFIG_VERSION = 3;
export interface WorkspaceConfig {
  version: typeof WORKSPACE_CONFIG_VERSION;
  root: string | null;
  identity: string | null;
  permissionsByIdentity: Record<string, ToolPermissions>;
}

const keys = new Set<string>(PERMISSION_KEYS);
export function isPermissionKey(value: unknown): value is PermissionKey {
  return typeof value === 'string' && keys.has(value);
}
export function isPermissionMode(value: unknown): value is PermissionMode {
  return value === 'allow' || value === 'ask' || value === 'deny';
}

export function defaultPermissions(): ToolPermissions {
  return {
    list_directory: 'allow', read_file: 'allow', search_files: 'allow', find_files: 'allow', stat_path: 'allow',
    external_read: 'ask', write_file: 'ask', apply_patch: 'ask', create_directory: 'ask',
    copy_path: 'ask', move_path: 'ask', rename_path: 'ask', delete_path: 'ask', shell: 'ask',
  };
}

function parsePermissions(value: unknown, legacy: boolean): ToolPermissions | undefined {
  const required = legacy ? PERMISSION_KEYS.filter(key => key !== 'shell') : PERMISSION_KEYS;
  if (!isRecord(value) || Object.keys(value).length !== required.length) return;
  const permissions = defaultPermissions();
  for (const key of required) {
    const mode = value[key];
    if (!Object.hasOwn(value, key) || !isPermissionMode(mode)) return;
    permissions[key] = mode;
  }
  return permissions;
}

export function loadWorkspaceConfig(file: string): { config: WorkspaceConfig; migrated: boolean } {
  const config: WorkspaceConfig = { version: WORKSPACE_CONFIG_VERSION, root: null, identity: null, permissionsByIdentity: {} };
  let data: unknown;
  try { data = readJSON(file); } catch { return { config, migrated: false }; }
  if (!isRecord(data)) return { config, migrated: false };
  if (typeof data.root === 'string' && isAbsolute(data.root)) {
    config.root = data.root;
    if (isWorkspaceIdentity(data.identity)) config.identity = data.identity;
  }

  // A legacy setting without a recorded identity cannot authorize a directory selected later.
  const legacySwitch = !Object.hasOwn(data, 'version') && config.root !== null && typeof data.autoWrite === 'boolean';
  const legacyProfiles = data.version === 2;
  if (legacySwitch && config.identity) {
    const permissions = defaultPermissions();
    if (data.autoWrite === true) {
      for (const tool of WRITE_TOOLS) if (tool !== 'delete_path') permissions[tool] = 'allow';
    }
    config.permissionsByIdentity[config.identity] = permissions;
  } else if ((legacyProfiles || data.version === WORKSPACE_CONFIG_VERSION) && isRecord(data.permissionsByIdentity)) {
    for (const [identity, raw] of Object.entries(data.permissionsByIdentity)) {
      if (!isWorkspaceIdentity(identity)) continue;
      const permissions = parsePermissions(raw, legacyProfiles);
      if (permissions) config.permissionsByIdentity[identity] = permissions;
    }
  }
  return { config, migrated: legacySwitch || legacyProfiles };
}
