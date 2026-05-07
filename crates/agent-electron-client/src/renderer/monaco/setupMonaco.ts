import { loader } from "@monaco-editor/react";

function resolveVsBaseUrl(): string {
  // dev: http://localhost:60173/
  // prod: file://.../dist/index.html (vite base './')
  // 统一用 URL 解析，避免 Windows 路径分隔符影响
  return new URL("./monaco/vs", window.location.href).toString();
}

loader.config({
  paths: {
    vs: resolveVsBaseUrl(),
  },
});
