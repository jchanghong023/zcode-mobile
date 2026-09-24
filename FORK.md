# Fork 与上游差异

本仓库源自上游 [zai-org/ZCode](https://github.com/zai-org/ZCode) 的 `main` 分支，已**大幅精简为 Android 远程 App 专用仓库**：Capacitor 8 壳（`apps/android/`）+ web UI 构建链。本页面向本人和 AI agent，只记录相对上游仍有效、对使用者有影响的差异，不记录实现细节或同步历史。开发规则见 `AGENTS.md`。

## 当前上游基线

- **分支**：`zai-org/ZCode@main`
- **版本**：`v3.14.3`
- **Upstream commit**：`328c1a0c0ffaa5a4f65e8fa199af5e4c20706e5f`
- **同步日期**：2026-09-23（此后仓库形状已偏离上游，见下）

## 本仓库的定位

把 ZCode 的浏览器 UI 原样封装为 Android App：WebView 以官方线上同源（`https://zcode.z.ai`）运行本地打包的 `packages/web` 产物；同源 `/api`、`/ws`、`/remote/*` 由原生层放行直连官方服务；OAuth 在应用内完成。壳层不实现、不代理、不修改官方协议。

## 仓库精简（相对上游的形状差异）

- **保留**：`packages/web` 及其构建依赖链（`ui`、`client`、`shared`、`services`、`rpc`、`provider`、`model-option-map`）、`apps/android`、根构建配置、`scripts/` 中 web 构建与治理所需脚本。
- **删除**：`packages/desktop`、`packages/server`、`packages/zcode-server-cli`、`packages/provider-node`、`packages/formal-proof`、`packages/zcode-cua`、`apps/zcode-cli`、`third-party/`、`patches/`、`.github/`、桌面/分发相关脚本。
- **上游同步策略变化**：不再追求整仓库与上游一致。上游更新时按需把 kept 包的改动**对照搬运**进本仓库（以 `packages/` 为参考副本或 git 对照），而非直接覆盖整个 `packages/`（本仓库已删除其中部分目录）。
- `packages/` 保留的 8 个包源码保持与上游一致，便于对照搬运。

## 差异需求

### Android 浏览器界面封装（Capacitor 8，已实现）

目标：把现有 `packages/web` 浏览器 UI 原样封装为 Android App；界面完整复用，不用 Kotlin/Compose、Flutter、React Native 重写。

行为边界：

- 只封装界面宿主：Android 端不运行 ZCode Server、Agent Runtime、OMP、Node.js，不重新实现、不代理、不修改官方网络协议；HTTPS API、WebSocket、OAuth/登录与会话全部直连 ZCode 官方服务（`https://zcode.z.ai`）。
- `packages/` 保留的 8 个包不携带本 Fork 的源码改动；全部 Android 适配收敛在 `apps/android/`。
- WebView 以官方同源运行本地打包的 web 产物：同源 `/api`、`/ws`、`/remote/*` 由原生层放行直连官方服务（`/remote/v4` 为官方托管的手机远控客户端，与手机浏览器打开同一链接完全一致），其余路径由本地资产响应（含 SPA 路由回退 `index.html`），OAuth 授权页在应用内完成并回跳同源 callback。
- 平台适配仅限容器能力：返回键（历史后退）、文件选择（Capacitor 内置）、下载（系统 DownloadManager）、键盘 insets（ime 按容器高 45% 封顶，`SystemBars.insetsHandling="disable"`）、`zcode.z.ai` 深链、图标冷启动恢复最后一次远控链接。
- 性能：WebView 异步预热（`startUpWebView`）、renderer 预热、官方域名 preconnect/QUIC hint（androidx.webkit 1.17.1）；不清缓存；APK 资产剥离 sourcemap。

验收结果：

- `pnpm build:android` 产出 APK；真机实测：远控链接连接桌面、GLM-5.3-Flash 对话往返、微信输入法布局正常、图标冷启动自动恢复远控页。
- 修改 React UI 后重跑 `pnpm build:android` 即可随包更新，无需改动 `packages/` 以外任何源码。

### 已知与允许的差异

- 上游的桌面端、Server、Agent CLI（含 omp 换核需求）不在本仓库范围内：换核需求属于桌面产品形态，本仓库已无桌面端，该需求不再适用。
- App 桌面图标冷启动恢复的是最后一次远控链接；未配对过的全新安装进入本地 SPA 空壳根路径（官方服务不为未配对客户端提供独立会话），需从桌面端扫码/发链接进入。
- 上游 `packages/web` 构建产物的 sourcemap 在 APK 内被剥离；需要符号排错时在 `packages/web/dist` 原件中查看。
