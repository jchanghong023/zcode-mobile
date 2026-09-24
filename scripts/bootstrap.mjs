#!/usr/bin/env node
// 仓库 bootstrap（Android 远程壳精简版）：安装依赖并完成 web 构建链的类型检查。
// 历史上的 submodule 拉取、desktop/server/CLI 构建已随精简移除；如需恢复请回溯 git 历史。

import process from "node:process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runCommand } from "./spawn-command.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "..");
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function runPnpm(args, options = {}) {
  runCommand(pnpmCommand, args, {
    stdio: "inherit",
    cwd: rootDir,
    ...options,
    env: { ...process.env, ...options.env },
  });
}

if (!existsSync(resolve(rootDir, "pnpm-lock.yaml"))) {
  console.error("[bootstrap] pnpm-lock.yaml 缺失，请在仓库根目录执行");
  process.exit(1);
}

runPnpm(["install"]);
runPnpm(["run", "typecheck"]);
console.log(
  "[bootstrap] 完成：依赖已安装，web 构建链类型检查通过。Android 打包用 pnpm build:android。",
);
