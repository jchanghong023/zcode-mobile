package dev.jchanghong.zcode;

import android.app.Activity;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.view.View;
import android.view.inputmethod.InputMethodManager;
import android.content.Context;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.util.function.Consumer;

/** 项目、聊天与远控链接设置的原生导航；WebView 始终保留在下层。 */
final class NativeNavigation {

    private static final int BAR_HEIGHT_DP = 56;
    private static final int SURFACE = Color.rgb(31, 31, 31);
    private static final int BACKGROUND = Color.rgb(22, 22, 22);
    private static final int TEXT = Color.rgb(245, 245, 245);
    private static final int MUTED = Color.rgb(174, 174, 174);
    private static final int SELECTED = Color.rgb(119, 166, 255);

    private final Activity activity;
    private final LinearLayout bar;
    private final ScrollView settingsScreen;
    private final TextView projectTab;
    private final TextView chatTab;
    private final TextView settingsTab;
    private final TextView connectionStatus;
    private final EditText linkInput;
    private boolean settingsVisible;
    private String selectedWebTab = "projects";

    NativeNavigation(
        Activity activity,
        String initialLink,
        Consumer<String> onConnect,
        Consumer<String> onNavigate
    ) {
        this.activity = activity;
        FrameLayout root = activity.findViewById(android.R.id.content);

        settingsScreen = new ScrollView(activity);
        settingsScreen.setFillViewport(true);
        settingsScreen.setBackgroundColor(BACKGROUND);
        settingsScreen.setClickable(true);
        settingsScreen.setVisibility(View.GONE);
        LinearLayout form = new LinearLayout(activity);
        form.setOrientation(LinearLayout.VERTICAL);
        form.setPadding(dp(20), 0, dp(20), 0);
        settingsScreen.addView(form, new ScrollView.LayoutParams(-1, -2));

        TextView title = new TextView(activity);
        title.setText("远程连接设置");
        title.setTextColor(TEXT);
        title.setTextSize(22);
        title.setTypeface(null, Typeface.BOLD);
        form.addView(title, spaced(-1, -2, 8));

        TextView description = new TextView(activity);
        description.setText("粘贴桌面端生成的完整 /remote/v4 链接。页面和界面资源始终来自本机 APK。");
        description.setTextColor(MUTED);
        description.setTextSize(14);
        form.addView(description, spaced(-1, -2, 20));

        connectionStatus = new TextView(activity);
        connectionStatus.setTextColor(MUTED);
        connectionStatus.setTextSize(14);
        form.addView(connectionStatus, spaced(-1, -2, 12));

        linkInput = new EditText(activity);
        linkInput.setHint("https://zcode.z.ai/remote/v4?sid=…&hash=…");
        linkInput.setTextColor(TEXT);
        linkInput.setHintTextColor(MUTED);
        linkInput.setTextSize(16);
        linkInput.setMinLines(4);
        linkInput.setMaxLines(7);
        linkInput.setGravity(Gravity.TOP | Gravity.START);
        linkInput.setInputType(
            android.text.InputType.TYPE_CLASS_TEXT |
            android.text.InputType.TYPE_TEXT_VARIATION_URI |
            android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE
        );
        linkInput.setBackground(roundedInputBackground());
        linkInput.setPadding(dp(14), dp(12), dp(14), dp(12));
        // 配对 hash 属于凭据：设置页仅显示保存状态，不把完整链接回显在屏幕上。
        setLink(initialLink);
        form.addView(linkInput, spaced(-1, -2, 16));

        Button connect = new Button(activity);
        connect.setText("保存并连接");
        connect.setAllCaps(false);
        connect.setTextColor(Color.WHITE);
        connect.setBackgroundTintList(ColorStateList.valueOf(Color.rgb(44, 112, 231)));
        connect.setOnClickListener(v -> onConnect.accept(linkInput.getText().toString().trim()));
        form.addView(connect, spaced(-1, dp(48), 0));

        root.addView(settingsScreen, new FrameLayout.LayoutParams(-1, -1));

        bar = new LinearLayout(activity);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setBackgroundColor(SURFACE);
        bar.setElevation(dp(8));
        projectTab = tab("项目", () -> {
            showSettings(false);
            selectWebTab("projects");
            onNavigate.accept("projects");
        });
        chatTab = tab("聊天", () -> {
            showSettings(false);
            selectWebTab("chat");
            onNavigate.accept("chat");
        });
        settingsTab = tab("设置", () -> showSettings(true));
        bar.addView(projectTab, new LinearLayout.LayoutParams(0, dp(BAR_HEIGHT_DP), 1));
        bar.addView(chatTab, new LinearLayout.LayoutParams(0, dp(BAR_HEIGHT_DP), 1));
        bar.addView(settingsTab, new LinearLayout.LayoutParams(0, dp(BAR_HEIGHT_DP), 1));
        FrameLayout.LayoutParams barParams = new FrameLayout.LayoutParams(-1, dp(BAR_HEIGHT_DP));
        barParams.gravity = Gravity.BOTTOM;
        root.addView(bar, barParams);
        showSettings(initialLink == null);
    }

    private TextView tab(String label, Runnable action) {
        TextView tab = new TextView(activity);
        tab.setText(label);
        tab.setTextSize(14);
        tab.setGravity(Gravity.CENTER);
        tab.setClickable(true);
        tab.setFocusable(true);
        tab.setOnClickListener(v -> action.run());
        return tab;
    }

    private GradientDrawable roundedInputBackground() {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(Color.rgb(43, 43, 43));
        drawable.setCornerRadius(dp(12));
        drawable.setStroke(dp(1), Color.rgb(78, 78, 78));
        return drawable;
    }

    private LinearLayout.LayoutParams spaced(int width, int height, int bottomDp) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(width, height);
        params.bottomMargin = dp(bottomDp);
        return params;
    }

    private int dp(int value) {
        return Math.round(value * activity.getResources().getDisplayMetrics().density);
    }

    void setLink(String link) {
        connectionStatus.setText(link == null ? "尚未设置连接链接" : "已保存连接链接，可粘贴新链接替换");
        linkInput.setText("");
    }

    boolean isSettingsVisible() {
        return settingsVisible;
    }

    void selectWebTab(String tab) {
        selectedWebTab = tab;
        updateTabColors();
    }

    void showSettings(boolean visible) {
        settingsVisible = visible;
        settingsScreen.setVisibility(visible ? View.VISIBLE : View.GONE);
        updateTabColors();
        if (!visible) {
            InputMethodManager keyboard = (InputMethodManager) activity.getSystemService(Context.INPUT_METHOD_SERVICE);
            keyboard.hideSoftInputFromWindow(linkInput.getWindowToken(), 0);
            linkInput.clearFocus();
        }
    }

    private void updateTabColors() {
        projectTab.setTextColor(!settingsVisible && "projects".equals(selectedWebTab) ? SELECTED : MUTED);
        chatTab.setTextColor(!settingsVisible && "chat".equals(selectedWebTab) ? SELECTED : MUTED);
        settingsTab.setTextColor(settingsVisible ? SELECTED : MUTED);
    }

    void applyInsets(int top, int bottom, int imeBottom, int imeCap) {
        boolean keyboardVisible = imeBottom > bottom;
        bar.setVisibility(keyboardVisible ? View.GONE : View.VISIBLE);
        FrameLayout.LayoutParams barParams = (FrameLayout.LayoutParams) bar.getLayoutParams();
        int barHeight = dp(BAR_HEIGHT_DP) + bottom;
        if (barParams.height != barHeight) {
            barParams.height = barHeight;
            bar.setLayoutParams(barParams);
        }
        bar.setPadding(0, 0, 0, bottom);
        settingsScreen.setPadding(
            0,
            top + dp(24),
            0,
            (keyboardVisible ? Math.min(imeBottom, imeCap) : barHeight) + dp(24)
        );
    }

    int contentBottomInset(int barsBottom, int imeBottom, int imeCap) {
        return imeBottom > barsBottom
            ? Math.min(imeBottom, imeCap)
            : barsBottom + dp(BAR_HEIGHT_DP);
    }
}
