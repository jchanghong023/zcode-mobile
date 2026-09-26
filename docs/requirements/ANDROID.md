# Android 宿主与平台需求

本文件从原 apps/android/SPEC.md 与 FORK.md 迁移，维护 Android 平台行为；全局范围见 [FORK.md](FORK.md)，远控业务行为见 [REMOTE.md](REMOTE.md)。

## 本地页面与网络

- WebView 以官方同源 https://zcode.z.ai 运行 APK 内置 Web UI。同源 /api*、/ws* 请求放行到 WebView 网络栈，WebSocket 直接联网；同源其他路径由本地资产响应，无扩展名 SPA 路径回退 index.html，包括根路径、/cn/share/callback 与分享页。
- 不下载官网 /remote/v4/latest/ 页面资产。API 失败保持 Web 客户端原有失败语义（例如 server-info 失败时缺省工作区信息）；壳层不新增响应兜底、改写或 API 缓存，不注入业务 JS。
- OAuth 授权页在应用内完成并回到同源 callback。同源及配置允许的 chat.z.ai、bigmodel.cn、\*.bigmodel.cn 导航留在 WebView，其他主机的链接交给系统浏览器；其他主机资源按正常网络访问。
- 壳层不持有任务、会话等业务状态，也不另建业务凭据管理；仅保留恢复连接所需的私有配置，敏感数据约束见 REMOTE.md。

## 启动、配对链接与导航

- 接收官方域名的 HTTPS 深链，复用现有 Activity。完整 /remote/v4?... 链接转换为本地 UI 的连接参数；分享页与 ?remote= 路由保留原行为。
- 图标冷启动恢复最后一次远控链接。未配对的新安装进入本地 SPA 根路径，需要桌面端扫码/发链接；官方服务不为未配对客户端提供独立会话。
- 原生底部导航包含“项目 / 聊天 / 设置”。项目和聊天的 Web 行为由 REMOTE.md 定义；设置可粘贴完整链接并连接，仍进入本地 UI。
- 键盘出现时隐藏底部导航，WebView 可用高度扣除导航栏。返回键有历史时后退，否则将任务移入后台；OAuth 跳转链也应可回退。

## 输入与文件

- 文件选择沿用 Capacitor 内置能力。
- HTTP/HTTPS 下载使用系统 DownloadManager，保存到公共 Downloads。API≤28 时在用户发起下载时申请 WRITE_EXTERNAL_STORAGE 权限。
- WebView 生成的文件通过 Android 保存文件对话框写入用户选择的位置；blob: 不交给仅支持 HTTP/HTTPS 的 DownloadManager，取消保存不写文件。图片与表格导出的保存路径已有实现，属于此要求的适用场景。
- edge-to-edge 布局避让系统栏、屏幕缺口和键盘；IME 占用按容器高 45% 封顶，避免微信输入法等透明全屏键盘报告过高 insets 导致输入区压缩。只保留一处有效 insets 处理，API<30 也需要收到键盘变化。
- 状态栏透明、图标默认浅色，与默认 zai-dark 主题一致；浅色主题下图标深浅差异保留为已知限制，未在本次扩展为新功能。

## 性能、构建与调试边界

- 使用 WebView 异步启动预热、renderer 预热和官方域名 preconnect/QUIC hint；保留缓存。实现采用 androidx.webkit 1.17.1，性能收益仅能由真机对照记录确认。
- Web 产物以 production 环境构建，避免本地测试端点进入包；修改 React UI 后重新构建 APK 即随包更新。
- APK 内剥离 sourcemap；packages/web/dist 原件保留供符号排错，不能为减小 APK 删除该原件。
- debug 构建可信任仓库测试 CA 与用户 CA，用于模拟器 mock 中继测试。release 构建不信任这些额外锚点。模拟链路不能代替官方服务的真实验收。

## 验收条件与状态

1. 构建生成 APK，深链及设置页粘贴链接均打开内置页面；网络记录中没有官网 /remote/v4 HTML、JS、CSS 下载。请求分流、OAuth 应用内登录/回跳及失败行为符合上述边界，手机无本地 server/runtime 进程。
2. 在 384 CSS px 手机视口上聊天与输入框完整可见；实际键盘弹出/收起、底部导航、返回键和冷启动恢复均符合要求。项目与消息链路按 REMOTE.md 验收。
3. 文件选择可用；HTTP/HTTPS 下载与生成文件保存都得到正确文件，取消不写入；低版本权限与 debug/release 信任范围分别验证。
4. 比较改动前后页面资源传输量与连接耗时，以真机记录报告性能，不设置没有依据的指标。

已有实现，当前验收未复跑；设备测试缺口与自动化要求见 [AGENTS.md](../../AGENTS.md)。
