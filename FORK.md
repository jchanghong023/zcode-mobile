# Fork 与上游差异

本仓库 fork 自上游 [zai-org/ZCode](https://github.com/zai-org/ZCode) 的 `main` 分支，仅供个人使用，持续同步上游。本 Fork 的目的：把 ZCode 的 Agent 核心替换为 omp（oh-my-pi）的 RPC 核心，保留 ZCode 的全部用户界面与交互形态。

本页面向本人和 AI agent，只记录相对当前上游基线仍有效、对使用者有影响的差异需求，不记录实现细节、修复或同步历史。开发规则与上游同步的操作规则见 `AGENTS.md`。

## 当前上游基线

- **分支**：`zai-org/ZCode@main`
- **版本**：`v3.14.3`
- **Upstream commit**：`328c1a0c0ffaa5a4f65e8fa199af5e4c20706e5f`
- **同步日期**：2026-09-23

版本以提交说明与 README 更新记录为准；根 `package.json` 的 `version` 字段（3.14.0）滞后，不作为基线依据。

## 本 Fork 的目的

把本地 Agent 核心从上游 `apps/zcode-cli`（Agent CLI 与运行时）替换为 omp 的 RPC 核心，ZCode 侧通过适配层对接。产品形态、全部界面与既有双链路语义保持不变；omp 自身的功能演进在其自己的 fork 仓库进行，本仓库只消费其 RPC 核心能力，不重定义 omp。

## omp 侧依赖

- 来源：本人维护的 fork `jchanghong023/oh-my-pi`（本地工作目录 `D:\code1111111111\oh-my-pi`；上游为 `can1357/oh-my-pi`）。
- 接入形态：`omp --mode rpc` 启动的无头核心——stdio 上的 newline-delimited JSON 协议，含 ready 帧、协议版本协商、命令/响应关联、会话事件与 host 工具请求。
- 接口参考与测试基线：接口与协议开发参考本地源码 `D:\code1111111111\oh-my-pi`（协议细节含该仓库 `docs/rpc.md`）；实际测试（含换核验收 E2E）使用 releases 实际内嵌的发布版本二进制执行，不以本地源码的未发布改动为测试对象。
- 分发：随 ZCode 安装包内嵌——打包时取该 fork GitHub releases 页面（`https://github.com/jchanghong023/oh-my-pi/releases`）的最新版本二进制，内嵌进应用资源并由应用拉起；用户无需单独安装 omp。不依赖上游 oh-my-pi 的 npm / Homebrew / Nix / `omp.sh` 分发。
- 内嵌 omp 的配置与边界：内嵌拷贝与用户已安装的 omp 使用完全相同的配置（同一配置、凭据与会话数据来源），行为与用户日常使用的 omp 保持一致；NEVER 覆盖、替换、修改或代为安装用户已安装的 omp，内嵌拷贝只存在于 ZCode 应用资源目录内。

## 差异需求

本 Fork 的代码差异收敛在 `apps/android/` 与根级注册点（`pnpm-workspace.yaml`、根 `package.json` 命令、`architecture-policy.yaml`）；`packages/` 与上游保持完全一致（构建产物 `packages/*/dist` 除外），官方更新时可直接复制覆盖 `packages/` 后重建。需求已确认不代表实现或验证已完成。

### Agent 核心替换为 omp RPC 核心（待实现）

目标：桌面、Web 与手机远控的全部用户界面保留，本地 Agent 核心由 `omp --mode rpc` 提供；上游 `apps/zcode-cli` 不再作为产品核心维护。

行为边界：

- 换核只替换核心提供方，不缩减用户可感知能力：对话流式输出、工具调用展示、权限确认、会话管理、文件变更展示等现有能力保持对齐。
- Desktop 的 `desktop-continuous` 实时链路与手机/Web 的 `web-remote-replayable` 恢复链路语义保持不变：会话、流式、快照、重连与恢复行为不因换核回退，两条链路的差异由适配层弥合。
- UI 与核心之间保持清晰的契约边界，omp RPC 帧格式不直接渗入 UI 组件；协议适配方式属于实现自由度，不在本文件约束。
- 无法等价提供的能力必须列入「已知与允许的差异」并说明替代行为，不允许静默缺失或回退。

验收结果：

- 桌面应用端到端可用：新建会话 → 发送提示 → 流式回复与工具调用展示 → 权限确认 → 文件变更落地，全程不依赖 `zcode-cli`。
- 覆盖桌面实时链路与 Web/手机可恢复链路的 E2E 场景换核后全部通过，断线重连与会话恢复语义不回退。

### Android 浏览器界面封装（Capacitor 8，已实现）

目标：把现有 `packages/web` 浏览器 UI 原样封装为 Android App；界面完整复用，不用 Kotlin/Compose、Flutter、React Native 重写。

行为边界：

- 只封装界面宿主：Android 端不运行 ZCode Server、Agent Runtime、OMP、Node.js，不重新实现、不代理、不修改官方网络协议；HTTPS API、WebSocket、OAuth/登录与会话全部直连 ZCode 官方服务（`https://zcode.z.ai`）。
- `packages/` 不携带本 Fork 的源码改动，官方更新后可直接复制覆盖 `packages/` 再重建 Android App；全部 Android 适配收敛在 `apps/android/`。
- WebView 以官方同源（`https://zcode.z.ai`）运行本地打包的 web 产物：同源 `/api`、`/ws`、`/remote/*` 由原生层放行直连官方服务（`/remote/v4` 为官方托管的手机远控客户端，与手机浏览器打开同一链接完全一致），其余路径由本地资产响应（含 SPA 路由回退 `index.html`），OAuth 授权页在应用内完成并回跳同源 callback。
- 平台适配仅限容器能力：返回键（历史后退）、文件选择（Capacitor 内置）、下载（系统 DownloadManager）、键盘 insets、edge-to-edge、`zcode.z.ai` 深链；业务与网络行为与浏览器版一致。

验收结果：

- `pnpm build:android` 产出可安装 APK；App 启动后登录（OAuth）、会话与对话等线上功能与浏览器版行为一致，全程不依赖本地 server/runtime。
- 修改 React UI 后重跑 `pnpm build:android` 即可随包更新，无需改动 `packages/` 以外任何源码。

### 已知与允许的差异

- 尚无已确认条目。换核实现中发现无法对齐现有行为的能力时，必须在此逐项记录差异与替代行为，才可作为当前有效行为交付。
