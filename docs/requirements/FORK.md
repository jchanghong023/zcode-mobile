# ZCode Mobile 的 Fork 差异需求

本仓库源自 [zai-org/ZCode](https://github.com/zai-org/ZCode)，持续跟踪其 main 分支，只保留 Android 远程 App 所需内容。开发规则见 [AGENTS.md](../../AGENTS.md)。本目录是本地差异需求的唯一权威位置；本文件维护全局目标和范围，独立功能域按下表维护，不重复定义。

| 文档                     | 权威范围                                                     |
| ------------------------ | ------------------------------------------------------------ |
| [ANDROID.md](ANDROID.md) | 本地页面宿主、网络分流、深链、原生导航、键盘、文件和启动性能 |
| [REMOTE.md](REMOTE.md)   | v4 配对与工作区桥接、项目/聊天界面、连接恢复与业务状态边界   |

## 上游来源与证据边界

- 跟踪目标：zai-org/ZCode 的 main；原文记录版本 v3.14.3，2026-09-25 已核对。
- 已合入基线：29628c9acdb81b703bbd4080c207a0e7ce5e276e（由 26cf92b 合入）。2026-09-26 本地 Git 的 upstream/main 与 HEAD 共同基线均为该提交；本次未联网刷新上游，不将本地引用称为官方最新状态。
- 本地对照显示，保留包的源码差异集中在 web 的 v4 入口，以及 ui 的手机导航、侧栏、项目列表和文件保存适配。其余保留包与上述基线一致。这是当前实现状态，不是无需复核的永久保证。

## 目标与范围

把已有 ZCode 浏览器 UI 封装为 Capacitor 8 Android App，完整复用界面，不以 Kotlin/Compose、Flutter 或 React Native 重写。用户通过桌面端生成的远控链接，在手机上查看项目、任务并收发会话消息；桌面端仍负责执行。使用需要可用的 ZCode 账号与配对链接。

保留 packages/web 及 ui、client、shared、services、rpc、provider、model-option-map、provider-node、zcode-cua 构建依赖链，apps/android、根构建配置及必要的 web 构建和治理脚本。保留包沿用上游目录组织。

桌面端、Server、Agent CLI、OMP 不属于本仓库产品范围；原桌面换核需求不再适用。packages/desktop、packages/server、packages/zcode-server-cli、packages/formal-proof、apps/zcode-cli、third-party、patches、.github 及桌面/分发脚本不重新纳入。上游新增目录不自动成为本地范围。

Android 仅提供 UI 宿主和平台能力，不运行 Server、Agent Runtime、OMP 或 Node.js，不重新实现、代理或修改官方业务协议。v4 适配由 Web 入口负责。HTTPS API、WebSocket、OAuth/登录与会话直连官方服务；手机不作为业务状态的另一个权威来源。

## 实现与验证状态

原需求已标记 Android 封装为“已实现”；本次保留该实现状态，且源码中存在宿主、v4 配对、重连、工作区切换和保存文件路径。相关要求仍需本地维护，未发现上游基线已等价满足它们的证据；没有新增待实现功能规划或关键需求待确认项。

“已实现”不等于“已验收”。本次仅整理文档和检查引用，未执行 APK 构建、UT 或设备 E2E；各功能文档的验收条目是完成条件，不是测试通过记录。现有测试入口、覆盖缺口及后续验证要求见 AGENTS.md。
