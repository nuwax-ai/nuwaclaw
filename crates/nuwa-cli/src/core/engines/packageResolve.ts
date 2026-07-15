import { createRequire } from "node:module";

const runtimeRequire = createRequire(import.meta.url);

export function resolveInstalledPackageEntry(
  packageName: string,
  entrySpecifier: string,
): string {
  try {
    return runtimeRequire.resolve(entrySpecifier);
  } catch {
    throw new Error(
      `缺少 ${packageName} 依赖入口 ${entrySpecifier}。请重新运行 npm install 或 pnpm install。`,
    );
  }
}
