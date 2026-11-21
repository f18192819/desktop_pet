import { isAbsolute } from 'node:path';
import { PERMISSION_KEYS, WRITE_TOOLS } from '../../shared/agent';
import type { PermissionKey, PermissionMode, ToolPermissions } from '../../shared/agent';
import { readJSON } from '../chat/storage';
import { isRecord } from '../config';
import { isWorkspaceIdentity } from './WorkspaceSecurity';

export interface WorkspaceConfig {
  version: 2;
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
    copy_path: 'ask', move_path: 'ask', rename_path: 'ask', delete_path: 'ask',
  };
}

function isPermissions(value: unknown): value is ToolPermissions {
  return isRecord(value) && Object.keys(value).length === PERMISSION_KEYS.length
    && PERMISSION_KEYS.every(key => Object.hasOwn(value, key) && isPermissionMode(value[key]));
}

export function loadWorkspaceConfig(file: string): { config: WorkspaceConfig; migrated: boolean } {
  const config: WorkspaceConfig = { version: 2, root: null, identity: null, permissionsByIdentity: {} };
  let data: unknown;
  try { data = readJSON(file); } catch { return { config, migrated: false }; }
  if (!isRecord(data)) return { config, migrated: false };
  if (typeof data.root === 'string' && isAbsolute(data.root)) {
    config.root = data.root;
    if (isWorkspaceIdentity(data.identity)) config.identity = data.identity;
  }

  // A legacy setting without a recorded identity cannot authorize a directory selected later.
  const migrated = !Object.hasOwn(data, 'version') && config.root !== null && typeof data.autoWrite === 'boolean';
  if (migrated && config.identity) {
    const permissions = defaultPermissions();
    if (data.autoWrite === true) {
      for (const tool of WRITE_TOOLS) if (tool !== 'delete_path') permissions[tool] = 'allow';
    }
    config.permissionsByIdentity[config.identity] = permissions;
  } else if (data.version === 2 && isRecord(data.permissionsByIdentity)) {
    for (const [identity, permissions] of Object.entries(data.permissionsByIdentity)) {
      if (isWorkspaceIdentity(identity) && isPermissions(permissions)) {
        config.permissionsByIdentity[identity] = permissions;
      }
    }
  }
  return { config, migrated };
}
