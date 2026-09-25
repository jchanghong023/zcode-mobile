// Android v4：项目页完整列表注入。
// 桥接只选中一个 workspace，其余桌面端工作区/最近项目只进任务区数据源、不抢焦点；
// 缺了这份列表，项目页只会显示被桥接的单个 workspace，用户会看到「项目不完整」。

export function ensureInitialWorkspaceTabs(
  tabs: ReadonlyArray<{ workspacePath: string; workspaceIdentity?: string }> | undefined,
  initialWorkspaceAbsPath: string | undefined,
  initialWorkspaceIdentity: string | undefined,
  ensureWorkspaceTab: (path: string, options?: { workspaceIdentity?: string }) => void,
  injectedWorkspaceKeys: Set<string>,
): void {
  for (const tab of tabs ?? []) {
    if (
      !tab.workspacePath ||
      (tab.workspacePath === initialWorkspaceAbsPath &&
        tab.workspaceIdentity === initialWorkspaceIdentity)
    ) {
      continue;
    }
    // recentProjects 异步到达会重新传入完整列表；只补新增项，避免每次更新
    // 都让 ensureWorkspaceTab 重写已有 tab 并打断用户在侧栏中的操作。
    const key = `${tab.workspaceIdentity ?? ""}\0${tab.workspacePath}`;
    if (injectedWorkspaceKeys.has(key)) {
      continue;
    }
    injectedWorkspaceKeys.add(key);
    ensureWorkspaceTab(
      tab.workspacePath,
      tab.workspaceIdentity ? { workspaceIdentity: tab.workspaceIdentity } : undefined,
    );
  }
}
