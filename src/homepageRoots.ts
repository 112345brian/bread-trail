export interface VaultRootCandidate {
  path: string;
  hasChildren: boolean;
  hasParent: boolean;
  excluded?: boolean;
}

export function normalizeRootFolder(rootFolder = ''): string {
  return rootFolder.trim().replace(/^\/+|\/+$/g, '');
}

export function isPathInRootFolder(path: string, rootFolder = ''): boolean {
  const folder = normalizeRootFolder(rootFolder);
  return !folder || path.startsWith(folder + '/');
}

export function shouldIncludeVaultRoot(candidate: VaultRootCandidate, rootFolder = ''): boolean {
  const scopedFolder = normalizeRootFolder(rootFolder);
  if (candidate.excluded) return false;
  if (!isPathInRootFolder(candidate.path, scopedFolder)) return false;
  if (candidate.hasParent) return false;
  return scopedFolder ? true : candidate.hasChildren;
}
