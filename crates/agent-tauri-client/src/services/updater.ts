import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { Modal, message } from "antd";

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

  Modal.confirm({
    title: `发现新版本 v${version}`,
    content: body || "建议更新到最新版本以获得更好的体验。",
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
