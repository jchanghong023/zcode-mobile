import { Capacitor, registerPlugin } from "@capacitor/core";
import type { IPlatformService, SaveFileRequest, SaveFileResult } from "@zcode/shared";

interface ZCodeFileSavePlugin {
  save(options: { base64: string; suggestedName: string }): Promise<SaveFileResult>;
}

const fileSave = registerPlugin<ZCodeFileSavePlugin>("ZCodeFileSave");

function encodeBase64(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  const parts: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    parts.push(String.fromCharCode(...bytes.subarray(offset, offset + 32_768)));
  }
  return btoa(parts.join(""));
}

async function saveAndroidFile(payload: SaveFileRequest): Promise<SaveFileResult> {
  if (!payload.data) {
    // 网络资源继续走 WebView 的下载监听器，保留 Cookie 与跨域图片的原有路径。
    return { success: false, error: "source_url_not_supported" };
  }
  try {
    return await fileSave.save({
      base64: encodeBase64(payload.data),
      suggestedName: payload.suggestedName,
    });
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function withAndroidFileSave(platform: IPlatformService): IPlatformService {
  return Capacitor.getPlatform() === "android"
    ? { ...platform, saveFile: saveAndroidFile }
    : platform;
}
