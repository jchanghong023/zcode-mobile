# apps/android 模块规格（SPEC）

本模块是 ZCode 浏览器 UI 的 Android 宿主（Capacitor 8）。它不是业务模块：不持有任务、会话、凭据或任何业务状态，只提供界面容器与平台能力。业务网络全部直连 ZCode 官方服务。

## 所有权与边界

| 关注点           | 唯一所有者                                 | 说明                                                                                 |
| ---------------- | ------------------------------------------ | ------------------------------------------------------------------------------------ |
| Web 产物         | `packages/web`（vite build）               | `packages/` 与上游保持一致，本模块不修改其源码                                       |
| Android 资产副本 | Capacitor `cap sync android`               | 从 `../../packages/web/dist` 复制到 `android/app/src/main/assets/public`，不手工编辑 |
| 请求分流         | `ZCodeWebViewClient`                       | 唯一决定哪些同源路径走真实网络的地方                                                 |
| 应用同源身份     | `capacitor.config.ts` 的 `server.hostname` | 来自 `@zcode/shared/zcodeEndpoint` 的 `DEFAULT_ZCODE_ENDPOINT_ORIGIN`，不手写 host   |
| 平台适配         | `MainActivity`                             | insets、返回键、下载、深链，全部原生实现，不向 web 注入 JS                           |

不变量：

1. `packages/` 源码零改动；官方更新 `packages/` 后重跑构建即可出新包。
2. 不实现、不代理、不修改任何官方网络协议；所有请求由 WebView 自身网络栈直连官方域名。
3. WebView 内 `window.location.origin === https://zcode.z.ai`（与官方线上同源），因此 `packages/web` 的相对路径请求（`/ws`、`/api/*`）与 OAuth `redirect_uri` 无需任何源码适配即可指向官方服务。

## 请求分流模型

```text
WebView（origin = https://zcode.z.ai，本地资产）
  ├── 同源 /api*、/ws* ── ZCodeWebViewClient 放行（return null）──► WebView 网络栈 ──► 官方 zcode.z.ai
  ├── 同源 /remote/* ── 同样放行 ──► 官方托管的手机远控客户端（/remote/v4/latest/*，源码不在本仓库）
  ├── 同源其余路径 ── Capacitor WebViewLocalServer
  │     ├── 静态文件存在 ──► assets/public 本地文件
  │     └── 无扩展名路径（/、/cn/share/callback、/cn/share/<code>）──► html5mode 回退 index.html
  └── 其他 host（chat.z.ai、*.bigmodel.cn 授权页）──► 未注册拦截，直连网络；
        导航策略：同源与 allowNavigation 域留在 WebView，其余跳系统浏览器
WebSocket（wss://zcode.z.ai/ws、/ws/remote/:id）：不经 shouldInterceptRequest，天然直连。
```

失败语义：`/api` 直连失败时与浏览器行为一致（`packages/web` 内已有降级路径，例如 `/api/server-info` 失败仅缺省 workspace 信息）；本模块不新增兜底、不缓存响应。

## 平台能力清单

| 能力              | 实现                                                                                                                                                                                                                      | 备注                                                                                                                                                                                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 返回键            | `MainActivity` OnBackPressedDispatcher：`canGoBack` 则 `goBack`，否则 `moveTaskToBack`                                                                                                                                    | OAuth 跳转链可回退                                                                                                                                                                                                                                                  |
| 文件选择          | Capacitor `BridgeWebChromeClient.onShowFileChooser`                                                                                                                                                                       | 内置，无需代码                                                                                                                                                                                                                                                      |
| 下载              | `setDownloadListener` → 系统 `DownloadManager`（公共 Downloads 目录）                                                                                                                                                     | API≤28 需 WRITE_EXTERNAL_STORAGE（manifest 已声明 maxSdkVersion=28）                                                                                                                                                                                                |
| 键盘/edge-to-edge | `setDecorFitsSystemWindows(false)` + insets 监听对 WebView 容器加 padding（systemBars \| displayCutout \| ime，**ime 按容器高 45% 封顶**）；`plugins.SystemBars.insetsHandling="disable"` 关闭 Capacitor 内置 insets 处理 | 微信输入法等以全屏透明窗口承载键盘，`Type.ime()` insets 虚高（实测 ~70% 屏高）；Capacitor 内置 SystemBars 插件还会在 DecorView 上叠加未修正的 imeInsets，双层收缩把 WebView 压成一条、输入框上方留出大片空白；manifest `adjustResize` 保证 API<30 也派发 ime insets |
| 深链              | `https://zcode.z.ai` VIEW intent-filter（singleTask），onCreate/onNewIntent 中 `loadUrl`                                                                                                                                  | `/remote/v4` 远控链接（官方托管客户端）、分享页与 `?remote=` 均可从外部打开                                                                                                                                                                                         |
| 状态栏            | 透明（edge-to-edge），图标默认浅色                                                                                                                                                                                        | 与默认 zai-dark 主题一致；浅色主题下的图标深浅差异为已知限制                                                                                                                                                                                                        |

## 构建管线

`pnpm build:android`（根）→ `apps/android/scripts/build.mjs`：

1. `ZCODE_ENV=production pnpm --filter @zcode/web build`（显式 production 防止 `.env.local` 误注入测试端点）。
2. `cap sync android`（复制 dist → assets/public，刷新原生插件配置）。
3. 剥离 `assets/public` 内全部 `*.map` sourcemap（hidden 模式产物无 sourceMappingURL 引用，纯体积死重，实测 80MB/2200+ 个；只删 APK 资产副本，不碰 `packages/web/dist` 原件）。
4. `--apk` 时执行 `gradlew assembleDebug`。

机器侧前提（不入库）：JDK 21（`~/.gradle/gradle.properties` 的 `org.gradle.java.home`）、Android SDK（`android/local.properties` 的 `sdk.dir`）。

## 验收

- `pnpm build:android --apk` 产出 `android/app/build/outputs/apk/debug/app-debug.apk`。
- App 行为与浏览器版一致：OAuth 登录、会话列表、对话流式输出；无本地 server/runtime 进程。
- `pnpm typecheck`、`pnpm lint`、`pnpm architecture:check -- --changed`、`pnpm fmt:check` 通过。
