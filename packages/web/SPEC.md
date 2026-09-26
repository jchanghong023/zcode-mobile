# Web UI 的 Android v4 远控入口

`packages/web` 继续提供 APK 内置的 ZCode UI。Android 收到 `/remote/v4` 配对链接后，把其参数交给本地 Web 入口；WebView 不加载官网远控页面。

## 所有权

- `packages/web` 的远控连接适配器唯一持有 relay WebSocket、配对状态、工作区桥接与 RPC 帧序号；React 页面只消费服务代理。
- Android 只保存最后一次配对链接并将查询参数交给本地入口，不实现业务协议。
- 桌面 Host 仍是任务、会话和工作区状态的唯一所有者；手机不缓存服务端事实。
- 项目列表的来源由远控入口统一合成：bootstrap 工作区先到，`recentProjects` 可异步补充；有 `workspaceIdentity` 的项目按身份和路径去重，不能因不同远端路径相同而丢失。列表注入只确保侧栏可见，不改变当前工作区。连接换代后，旧连接返回的设置结果不得进入新列表。
- **目录约定（合并冲突最小化）**：Android/v4 专属新代码只进独立文件——web 侧在 `packages/web/src/remote-v4/`（入口分流收口在 `entry.tsx`，`main.tsx` 仅一行分支）；ui 侧在 `packages/ui/src/v4/mobileRemoteShell.ts`（视口判定/页签导航）与 `MobileSidebarChrome.tsx`（侧栏遮罩/开关）、`packages/ui/src/root/initialWorkspaceTabs.ts`（项目列表注入）。上游桌面组件文件只保留对这些模块的最小引用行。

## 启动顺序

1. 校验配对参数 `sid`、`hash`、`t`，使用官方同源 `/ws` 建立终端连接并完成 challenge 鉴权。
2. 配对成功后请求窗口 bootstrap，从可桥接工作区中选择当前项；发送带唯一 ID 与代次的 `workspace-bridge-open`。
3. 桥接就绪后将 relay 的可靠 RPC 帧适配为 `IMessagePassingProtocol`，复用 `@zcode/client` 的服务代理渲染现有 `Root`；同时把该连接以 `v4-<bridgeSessionId>` 注册为绑定 `workspaceIdentity` 的 remote workspace session（`@zcode/ui` 的 workspace services 按 identity 判定远端目标，缺少注册时聊天面板会停留在 `remote-waiting`、`rpcReady=false` 而渲染空白），断开或换代时注销，避免残留 services 指向已关闭连接。项目页完整列表 = bootstrap 全部可桥接工作区 + 桌面端 `recentProjects` 兜底，经 `initialWorkspaceTabs` 注入（只进列表不抢焦点）；会话仍跑在单个被桥接的 workspace 上。后到的项目列表必须补入同一棵 `Root`；该写入以当前连接为所有者，重复列表不得反复改写 tab 状态。用户点选其他可桥接项目时，远控入口以该项目的身份重新配对并桥接；成功后才进入聊天，失败时保留明确错误和重试入口。项目/聊天页签切换本身不重连。
4. 网络中断时由远控入口负责恢复：前台按有上限的退避重新配对和桥接，后台暂停重试；返回前台立即恢复已断开的连接。后台停留较久时，先用现有只读设置 RPC 检查看似仍打开的连接，探测失败或超时才更换连接。手动重试可立即触发一次尝试。无效链接、relay 明确拒绝、桥接协议错误等不可恢复错误显示原因并停止自动重试。
5. 每次尝试只有一个所有者；旧尝试取消或旧连接断开后不得注册服务、写入项目列表或触发新连接。重连必须重新确认配对与桥接，不把旧代次响应交给当前 UI；成功后重置退避，失败时保留可手动重试入口。业务状态仍由桌面 Host 持有，不在手机端缓存服务端事实。

连接链接和鉴权值只留在运行时内存与 Android 私有偏好中，不进日志、构建产物或测试快照。没有远控参数的普通 Web 模式保持原有启动路径。

## 验收

- 真机深链进入本地 `packages/web` 页面，CDP 网络记录中没有 `/remote/v4` HTML、JS、CSS 下载。
- 手机宽度下「项目」直接呈现现有 `WorkspaceSidebar` 的完整内容与操作，「聊天」呈现现有主工作区；点项目或任务进入聊天。切换这两个页签保留同一棵 `Root` 与同一条 v4 连接，不重新配对。
- 手机「聊天」隐藏桌面端状态侧面板（`chat-summary-panel`：Git 工具/进程/计划），会话时间线占满整宽；桌面端布局不受影响。
- 真机完成配对、工作区与任务读取、会话消息往返；后台恢复和冷启动重新连接可用。
- 模拟后台停留、网络断开和恢复：后台不持续发起连接；回到前台无需点击即可恢复可用连接，旧连接的迟到响应不能覆盖新连接。失效配对链接保持明确错误，不无限重试。
- 比较改动前后页面资源传输量与连接耗时，性能结论只基于真机记录。
