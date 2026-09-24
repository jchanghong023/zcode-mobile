#!/usr/bin/env node
// apps/android 构建管线：web 生产构建 → cap sync →（可选）gradle assembleDebug。
// 详见同目录 SPEC.md。packages/ 源码零改动，产物由 packages/web 构建后同步进 Android 工程。
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");
const androidProjectDir = resolve(here, "..", "android");
const apkArgs = process.argv.includes("--apk");
const syncOnly = process.argv.includes("--sync-only");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    ...options,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function assertWebDist() {
  const webDist = resolve(repoRoot, "packages", "web", "dist");
  if (!existsSync(resolve(webDist, "index.html"))) {
    console.error("[apps/android] missing packages/web/dist/index.html — run the web build first");
    process.exit(1);
  }
}

/**
 * 剥离同步进 APK 资产里的 sourcemap（*.map）：生产构建 sourcemap:"hidden" 仍会产出
 * .map 文件（实测 80MB+/2200+ 个），浏览器不会加载它们（产物无 sourceMappingURL 注释），
 * 打进 APK 纯属体积浪费。只删 Android 资产副本，不碰 packages/web/dist 原件。
 */
function stripSourceMaps(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      stripSourceMaps(path);
    } else if (entry.name.endsWith(".map")) {
      rmSync(path);
    }
  }
}

// gradlew 启动器自身需要 JVM：优先 JAVA_HOME，其次读取用户级
// ~/.gradle/gradle.properties 的 org.gradle.java.home（机器侧配置，不入库）。
function resolveJavaHome() {
  if (process.env.JAVA_HOME) {
    return process.env.JAVA_HOME;
  }
  try {
    const gradleProperties = readFileSync(
      resolve(homedir(), ".gradle", "gradle.properties"),
      "utf8",
    );
    const matched = gradleProperties.match(/^org\.gradle\.java\.home\s*=\s*(.+)$/m);
    if (matched) {
      return matched[1].trim();
    }
  } catch {
    // 无用户级 gradle.properties 时按未配置处理。
  }
  return undefined;
}

// 显式 production：防止未跟踪的 .env.local 里 ZCODE_ENV=test 把测试端点注入进浏览器包。
run("pnpm", ["--filter", "@zcode/web", "build"], {
  cwd: repoRoot,
  env: { ...process.env, ZCODE_ENV: "production" },
});
assertWebDist();

run("pnpm", ["exec", "cap", "sync", "android"], { cwd: resolve(here, "..") });
stripSourceMaps(resolve(androidProjectDir, "app", "src", "main", "assets", "public"));

if (syncOnly) {
  process.exit(0);
}

if (apkArgs) {
  const javaHome = resolveJavaHome();
  if (!javaHome) {
    console.error(
      "[apps/android] 未找到 JDK：请设置 JAVA_HOME 或在 ~/.gradle/gradle.properties 配置 org.gradle.java.home（JDK 21）",
    );
    process.exit(1);
  }
  const gradlew = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
  run(gradlew, ["assembleDebug"], {
    cwd: androidProjectDir,
    env: { ...process.env, JAVA_HOME: javaHome },
  });
  console.log("[apps/android] APK: android/app/build/outputs/apk/debug/app-debug.apk");
}
