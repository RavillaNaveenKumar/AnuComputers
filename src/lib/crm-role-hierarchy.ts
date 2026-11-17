export function roleParentCreatesCycle(
  roleId: string,
  parentId: string | null,
  parentByRoleId: ReadonlyMap<string, string | null>,
) {
  const visited = new Set<string>();
  let currentId = parentId;
  while (currentId) {
    if (currentId === roleId || visited.has(currentId)) return true;
    visited.add(currentId);
    currentId = parentByRoleId.get(currentId) ?? null;
  }
  return false;
}
