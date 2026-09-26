export interface MobileRemoteWorkspaceTab {
  workspacePath: string;
  workspaceIdentity?: string;
}

/** 项目身份由远端 identity 与路径共同决定；最近项目只有路径，不能覆盖已知远端。 */
export function buildMobileRemoteWorkspaceTabs(
  availableWorkspaces: ReadonlyArray<MobileRemoteWorkspaceTab>,
  recentProjects: ReadonlyArray<string>,
): MobileRemoteWorkspaceTab[] {
  const byKey = new Map<string, MobileRemoteWorkspaceTab>();
  const availablePaths = new Set<string>();
  for (const item of availableWorkspaces) {
    const key = `${item.workspaceIdentity ?? ""}\0${item.workspacePath}`;
    byKey.set(key, item);
    availablePaths.add(item.workspacePath);
  }
  for (const path of recentProjects) {
    if (path && !availablePaths.has(path)) {
      byKey.set(`\0${path}`, { workspacePath: path });
    }
  }
  return [...byKey.values()];
}
