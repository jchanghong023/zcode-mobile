// Android v4：项目页完整列表注入。
// 桥接只选中一个 workspace，其余桌面端工作区/最近项目只进任务区数据源、不抢焦点；
// 缺了这份列表，项目页只会显示被桥接的单个 workspace，用户会看到「项目不完整」。

export function ensureInitialWorkspaceTabs(
  tabs: ReadonlyArray<{ workspacePath: string; workspaceIdentity?: string }> | undefined,
  initialWorkspaceAbsPath: string | undefined,
  ensureWorkspaceTab: (path: string, options?: { workspaceIdentity?: string }) => void,
): void {
  for (const tab of tabs ?? []) {
    if (!tab.workspacePath || tab.workspacePath === initialWorkspaceAbsPath) {
      continue;
    }
    ensureWorkspaceTab(
      tab.workspacePath,
      tab.workspaceIdentity ? { workspaceIdentity: tab.workspaceIdentity } : undefined,
    );
  }
}
