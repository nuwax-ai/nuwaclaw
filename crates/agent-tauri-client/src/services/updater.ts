import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { message, Modal } from "antd";
import React from "react";

const DEFAULT_MESSAGE = "建议更新到最新版本以获得更好的体验。";

/** 旧格式安装说明的特征文本，匹配到任意一个即视为旧格式 */
const OLD_FORMAT_MARKERS = [
  "Assets 中下载",
  "_universal.dmg",
  "_aarch64.dmg",
  "_x64.dmg",
  ".msi",
  ".nsis",
  ".deb",
  ".AppImage",
];

/**
 * 检测 body 是否为旧格式的安装说明（而非更新日志）
 */
function isOldFormatBody(body: string): boolean {
  return OLD_FORMAT_MARKERS.some((marker) => body.includes(marker));
}

/**
 * 将简易 markdown 文本格式化为 React 元素
 *
 * 支持：
 * - `### 标题` → 加粗文本
 * - `- 列表项` → 带缩进的列表
 * - `**粗体**` → 加粗文本
 * - 空行 → 段落分隔
 */
function formatReleaseNotes(markdown: string): React.ReactNode {
  const lines = markdown.split("\n");
  const elements: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    if (trimmed.startsWith("### ")) {
      const title = trimmed.slice(4);
      elements.push(
        React.createElement(
          "div",
          {
            key: `h-${i}`,
            style: {
              fontWeight: 600,
              marginTop: elements.length > 0 ? 12 : 0,
              marginBottom: 4,
            },
          },
          title,
        ),
      );
    } else if (trimmed.startsWith("- ")) {
      const content = trimmed.slice(2);
      elements.push(
        React.createElement(
          "div",
          {
            key: `li-${i}`,
            style: { paddingLeft: 16, lineHeight: "24px" },
          },
          "• ",
          formatInlineText(content, i),
        ),
      );
    } else {
      elements.push(
        React.createElement(
          "div",
          { key: `p-${i}`, style: { lineHeight: "24px" } },
          formatInlineText(trimmed, i),
        ),
      );
    }
  }

  return React.createElement(
    "div",
    { style: { maxHeight: 300, overflowY: "auto" as const } },
    ...elements,
  );
}

/**
 * 处理行内 **粗体** 标记
 */
function formatInlineText(
  text: string,
  lineIndex: number,
): React.ReactNode[] | string {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  if (parts.length === 1) {
    return text;
  }
  return parts.map((part, j) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return React.createElement(
        "strong",
        { key: `b-${lineIndex}-${j}` },
        part.slice(2, -2),
      );
    }
    return part;
  });
}

/**
 * 检查应用更新，若有新版本则弹窗提示用户
 *
 * @param manual 是否为手动触发（手动触发时无更新也会提示）
 */
export async function checkForAppUpdate(manual = false): Promise<void> {
  try {
    const update = await check();
    if (!update) {
      console.log("[Updater] 当前已是最新版本");
      if (manual) {
        message.success("当前已是最新版本");
      }
      return;
    }

    console.log(`[Updater] 发现新版本: ${update.version}`);
    showUpdateDialog(update);
  } catch (error) {
    console.error("[Updater] 检查更新失败:", error);
    if (manual) {
      message.error("检查更新失败，请检查网络连接");
    }
  }
}

function showUpdateDialog(update: Update) {
  const { version, body } = update;

  let content: React.ReactNode;
  if (!body || isOldFormatBody(body)) {
    content = DEFAULT_MESSAGE;
  } else {
    content = formatReleaseNotes(body);
  }

  Modal.confirm({
    title: `发现新版本 v${version}`,
    content,
    okText: "立即更新",
    cancelText: "稍后再说",
    width: 440,
    onOk() {
      return performUpdate(update);
    },
  });
}

async function performUpdate(update: Update): Promise<void> {
  // 使用一个不可关闭的 Modal 展示下载进度
  const progressModal = Modal.info({
    title: "正在更新...",
    content: "正在下载更新包，请稍候...",
    okButtonProps: { style: { display: "none" } },
    closable: false,
    maskClosable: false,
    keyboard: false,
  });

  try {
    let downloaded = 0;
    let contentLength: number | undefined;

    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case "Started":
          contentLength = event.data.contentLength ?? undefined;
          console.log(`[Updater] 开始下载, 大小: ${contentLength} bytes`);
          break;
        case "Progress":
          downloaded += event.data.chunkLength;
          if (contentLength) {
            const percent = Math.round((downloaded / contentLength) * 100);
            progressModal.update({
              content: `正在下载更新包... ${percent}%`,
            });
          }
          break;
        case "Finished":
          console.log("[Updater] 下载完成");
          progressModal.update({
            content: "下载完成，正在安装...",
          });
          break;
      }
    });

    progressModal.update({
      content: "更新完成，即将重启应用...",
    });

    // 短暂延迟让用户看到提示
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await relaunch();
  } catch (error) {
    progressModal.destroy();
    console.error("[Updater] 更新失败:", error);
    Modal.error({
      title: "更新失败",
      content: `更新过程中出现错误: ${error}`,
    });
  }
}
