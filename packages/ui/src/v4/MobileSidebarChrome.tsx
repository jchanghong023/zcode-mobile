// Android v4 手机视口的侧栏浮层两件套：内容区遮罩与顶栏开关。
// 独立成文件以收敛 Fork 专属 UI，保持上游桌面组件零额外负担。
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { DesktopTopOverlayActionButton } from "@/DesktopTopOverlayActionButton.js";

/** 「项目」页签下盖在内容区上的遮罩；点击收起侧栏。 */
export function MobileSidebarBackdrop({ onToggle }: { onToggle: () => void }) {
  const { intl } = useZCodeIntl();
  return (
    <button
      type="button"
      data-mobile-sidebar-backdrop="true"
      aria-label={intl.formatMessage({ id: "workspaceSidebar.toggleSidebar" })}
      onClick={onToggle}
      className="absolute inset-0 z-20 hidden bg-black/40 max-sm:block"
    />
  );
}

/** 顶栏侧栏开关（手机宽度显示）；图标随侧栏可见态切换。 */
export function MobileSidebarToggle(props: {
  isSidebarVisible: boolean;
  title: string;
  shortcut: string;
  onToggle: () => void;
}) {
  const SidebarToggleIcon = props.isSidebarVisible ? PanelLeftClose : PanelLeftOpen;
  return (
    <div data-mobile-sidebar-toggle="true" className="sm:hidden">
      <DesktopTopOverlayActionButton
        title={props.title}
        shortcut={props.shortcut}
        ariaLabel={props.title}
        onClick={props.onToggle}
      >
        <SidebarToggleIcon className="size-4" />
      </DesktopTopOverlayActionButton>
    </div>
  );
}
