import { URL } from "node:url";
import type { CapacitorConfig } from "@capacitor/cli";
import { DEFAULT_ZCODE_ENDPOINT_ORIGIN } from "@zcode/shared/zcodeEndpoint";

// WebView 以官方线上同源（https://zcode.z.ai）运行本地打包的 packages/web 产物：
// 相对路径网络请求（/ws、/api/*）与 OAuth redirect_uri 不改 packages/ 源码即可指向官方服务。
// /api、/ws 的本地拦截豁免由 apps/android 原生层（ZCodeWebViewClient）负责。
const endpointOrigin = new URL(DEFAULT_ZCODE_ENDPOINT_ORIGIN);

const config: CapacitorConfig = {
  appId: "dev.jchanghong.zcode",
  appName: "ZCode",
  webDir: "../../packages/web/dist",
  server: {
    hostname: endpointOrigin.hostname,
    androidScheme: "https",
    // OAuth 授权页在应用内完成登录：chat.z.ai（ZAI）与 bigmodel.cn（BigModel）。
    allowNavigation: ["chat.z.ai", "bigmodel.cn", "*.bigmodel.cn"],
  },
  android: {
    // 与 packages/web 默认主题 zai-dark 的背景色一致，避免启动白闪。
    backgroundColor: "#161616",
  },
  plugins: {
    SystemBars: {
      // 关闭 Capacitor 内置的 insets 处理：它会在 DecorView 上直接垫原始
      // imeInsets.bottom，而微信输入法等以全屏透明窗口承载键盘导致该值虚高
      // （实测约 70% 屏高），与 MainActivity 的封顶逻辑叠加后把 WebView 压扁、
      // 输入框上方留出大片空白。统一收敛到 MainActivity 的单一封顶实现。
      insetsHandling: "disable",
    },
  },
};

export default config;
