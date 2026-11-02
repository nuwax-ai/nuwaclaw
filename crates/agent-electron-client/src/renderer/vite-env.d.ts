/// <reference types="vite/client" />

/** 应用版本号，由 Vite define 从 package.json 注入 */
declare const __APP_VERSION__: string;

declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}

declare module '*.css' {
  const content: string;
  export default content;
}
