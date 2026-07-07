import pc from "picocolors";
import { runAllDoctorChecks } from "../core/detect/doctorChecks.js";

export async function doctorCommand(): Promise<void> {
  const results = runAllDoctorChecks();
  let hasFailure = false;

  for (const result of results) {
    const mark = result.ok ? pc.green("✔") : pc.yellow("✖");
    if (!result.ok) hasFailure = true;
    console.log(`${mark} ${pc.bold(result.label)}: ${result.detail}`);
    if (result.fix) {
      console.log(`  ${pc.dim("→")} ${pc.dim(result.fix)}`);
    }
  }

  console.log();
  console.log(
    hasFailure
      ? pc.yellow("部分检测项未通过，见上方修复建议。")
      : pc.green("环境检测全部通过。"),
  );

  if (hasFailure) process.exitCode = 1;
}
