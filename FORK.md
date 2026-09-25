# 与上游 ZCode 的差异

本仓库是独立仓库，源自上游 [zai-org/ZCode](https://github.com/zai-org/ZCode) 的 `main` 分支，已**大幅精简为 Android 远程 App 专用仓库**：Capacitor 8 壳（`apps/android/`）+ web UI 构建链。本页面向本人和 AI agent，只记录相对上游仍有效、对使用者有影响的差异，不记录实现细节或同步历史。开发规则见 `AGENTS.md`。

## 当前上游基线

- **分支**：`zai-org/ZCode@main`
- **版本**：`v3.14.3`
- **Upstream commit**：`29628c9acdb81b703bbd4080c207a0e7ce5e276e`（已由 `26cf92b` 合入）
- **核对日期**：2026-09-25（当前官方 `main`；保留包与该提交内容一致，另有下述本项目差异）

## 本仓库的定位

把 ZCode 的浏览器 UI 封装为 Android App：WebView 以官方线上同源（`https://zcode.z.ai`）运行本地打包的 `packages/web` 产物；`/remote/v4` 链接仅提供连接参数，由内置 UI 经官方 `/ws` 中继连接桌面端。页面资产不从官方远控页下载；壳层不代理业务请求。

## 仓库精简（相对上游的形状差异）

- **保留**：`packages/web` 及其构建依赖链（`ui`、`client`、`shared`、`services`、`rpc`、`provider`、`model-option-map`、`provider-node`、`zcode-cua`）、`apps/android`、根构建配置、`scripts/` 中 web 构建与治理所需脚本。
- **删除**：`packages/desktop`、`packages/server`、`packages/zcode-server-cli`、`packages/formal-proof`、`apps/zcode-cli`、`third-party/`、`patches/`、`.github/`、桌面/分发相关脚本。
- **上游同步策略变化**：不再追求整仓库与上游一致。上游更新时按需把 kept 包的改动**对照搬运**进本仓库（以 `packages/` 为参考副本或 git 对照），而非直接覆盖整个 `packages/`（本仓库已删除其中部分目录）。
- `packages/web` 的 v4 连接入口和 `packages/ui` 的手机视口侧栏行为属于本项目；其余保留包源码保持与上游一致，上游更新时需对照搬运这些差异。

## 差异需求

### Android 浏览器界面封装（Capacitor 8，已实现）

目标：把现有 `packages/web` 浏览器 UI 原样封装为 Android App；界面完整复用，不用 Kotlin/Compose、Flutter、React Native 重写。

行为边界：

- 只封装界面宿主：Android 端不运行 ZCode Server、Agent Runtime、OMP、Node.js，不重新实现、不代理、不修改官方网络协议；HTTPS API、WebSocket、OAuth/登录与会话全部直连 ZCode 官方服务（`https://zcode.z.ai`）。
- v4 协议适配位于 `packages/web`；「项目」页复用 `packages/ui` 原有的完整侧栏，「聊天」页复用主工作区，两个页签共用同一条连接。Android 壳负责深链转换与原生「项目 / 聊天 / 设置」导航。
- WebView 以官方同源运行本地打包的 web 产物：同源 `/api`、`/ws` 由原生层放行直连官方服务，其余路径由本地资产响应（含 SPA 路由回退 `index.html`）。完整 `/remote/v4?...` 链接的参数进入本地 UI；不加载官网 `/remote/v4/latest/` 页面资产。OAuth 授权页在应用内完成并回跳同源 callback。
- 平台适配仅限容器能力：返回键（历史后退）、文件选择（Capacitor 内置）、下载（系统 DownloadManager）、键盘 insets（ime 按容器高 45% 封顶，`SystemBars.insetsHandling="disable"`）、`zcode.z.ai` 深链、图标冷启动恢复最后一次远控链接。
- 性能：WebView 异步预热（`startUpWebView`）、renderer 预热、官方域名 preconnect/QUIC hint（androidx.webkit 1.17.1）；不清缓存；APK 资产剥离 sourcemap。

验收结果：

- `pnpm build:android` 产出 APK；v4 本地 UI、官方中继握手、工作区与消息往返需在真机端到端验证。
- 修改 React UI 后重跑 `pnpm build:android` 即可随包更新；`packages/web` 的协议入口需随上游版本核对。

### 已知与允许的差异

- 上游的桌面端、Server、Agent CLI（含 omp 换核需求）不在本仓库范围内：换核需求属于桌面产品形态，本仓库已无桌面端，该需求不再适用。
- App 桌面图标冷启动恢复的是最后一次远控链接；未配对过的全新安装进入本地 SPA 空壳根路径（官方服务不为未配对客户端提供独立会话），需从桌面端扫码/发链接进入。
- 上游 `packages/web` 构建产物的 sourcemap 在 APK 内被剥离；需要符号排错时在 `packages/web/dist` 原件中查看。
