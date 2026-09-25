# apps/android 模块规格（SPEC）

本模块是 ZCode 浏览器 UI 的 Android 宿主（Capacitor 8）。它不是业务模块：不持有任务、会话、凭据或任何业务状态，只提供界面容器与平台能力。业务网络全部直连 ZCode 官方服务。

## 所有权与边界

| 关注点           | 唯一所有者                                 | 说明                                                                                 |
| ---------------- | ------------------------------------------ | ------------------------------------------------------------------------------------ |
| Web 产物         | `packages/web`（vite build）               | 内置 UI 与 Android v4 连接入口，规格见 `packages/web/SPEC.md`                        |
| Android 资产副本 | Capacitor `cap sync android`               | 从 `../../packages/web/dist` 复制到 `android/app/src/main/assets/public`，不手工编辑 |
| 请求分流         | `ZCodeWebViewClient`                       | 唯一决定哪些同源路径走真实网络的地方                                                 |
| 应用同源身份     | `capacitor.config.ts` 的 `server.hostname` | 来自 `@zcode/shared/zcodeEndpoint` 的 `DEFAULT_ZCODE_ENDPOINT_ORIGIN`，不手写 host   |
| 平台适配         | `MainActivity`                             | insets、返回键、下载、深链、底部原生导航与连接设置，不向 web 注入 JS                 |

不变量：

1. Android v4 连接适配仅修改 `packages/web` 的入口和相邻模块；其余 `packages/` 保持上游原样，官方更新时需对照适配。
2. 壳层不实现、不代理、不修改官方网络协议；所有业务请求由 WebView 自身网络栈直连官方域名。
3. WebView 内 `window.location.origin === https://zcode.z.ai`（与官方线上同源），因此 `packages/web` 的相对路径请求（`/ws`、`/api/*`）与 OAuth `redirect_uri` 无需任何源码适配即可指向官方服务。

## 请求分流模型

```text
WebView（origin = https://zcode.z.ai，本地资产）
  ├── 同源 /api*、/ws* ── ZCodeWebViewClient 放行（return null）──► WebView 网络栈 ──► 官方 zcode.z.ai
  ├── /remote/v4 配对深链 ── MainActivity 转为内置 Web UI 的连接参数
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
| 深链              | `https://zcode.z.ai` VIEW intent-filter（singleTask）；`/remote/v4` 链接转为本地首页连接参数，图标冷启动恢复该配置                                                                                                        | 页面始终是 APK 内置 `packages/web`；分享页与 `?remote=` 保留原路由                                                                                                                                                                                                  |
| 调试网络信任      | `res/xml/network_security_config.xml` 的 `debug-overrides` 信任 `@raw/zcode_test_ca` 与用户 CA                                                                                                                            | 仅 `android:debuggable=true` 的 debug 构建生效；用于模拟器本地 mock 中继的 v4 端到端测试（adb root + iptables 443 重定向 + `adb reverse`），release 构建不受任何影响，不信任额外锚点                                                                          |
| 状态栏            | 透明（edge-to-edge），图标默认浅色                                                                                                                                                                                        | 与默认 zai-dark 主题一致；浅色主题下的图标深浅差异为已知限制                                                                                                                                                                                                        |
| 底部导航          | Android 原生「项目」「聊天」「设置」三项；键盘显示时隐藏导航，WebView 可用高度扣除导航栏                                                                                                                                  | 项目与聊天使用本地 Web 页签切换，不重载页面；设置页可粘贴完整 `/remote/v4?...` 链接并连接                                                                                                                                                                           |

## 构建管线

`pnpm build:android`（根）→ `apps/android/scripts/build.mjs`：

1. `ZCODE_ENV=production pnpm --filter @zcode/web build`（显式 production 防止 `.env.local` 误注入测试端点）。
2. `cap sync android`（复制 dist → assets/public，刷新原生插件配置）。
3. 剥离 `assets/public` 内全部 `*.map` sourcemap（hidden 模式产物无 sourceMappingURL 引用，纯体积死重，实测 80MB/2200+ 个；只删 APK 资产副本，不碰 `packages/web/dist` 原件）。
4. `--apk` 时执行 `gradlew assembleDebug`。

机器侧前提（不入库）：JDK 21（`~/.gradle/gradle.properties` 的 `org.gradle.java.home`）、Android SDK（`android/local.properties` 的 `sdk.dir`）。

## 验收

- `pnpm build:android --apk` 产出 `android/app/build/outputs/apk/debug/app-debug.apk`。
- v4 链接在真机进入 APK 内置 UI，静态脚本与样式不从 `/remote/v4/latest/` 下载；工作区、任务与消息往返经官方中继完成；无本地 server/runtime 进程。
- 384 CSS px 手机视口内聊天和输入框完整可见；「项目」页全屏显示原有侧栏的完整内容与操作，点项目或任务进入聊天。底部原生导航可切换项目/聊天/设置；设置粘贴新链接后仍进入本地 UI。
- `pnpm typecheck`、`pnpm lint`、`pnpm architecture:check -- --changed`、`pnpm fmt:check` 通过。
