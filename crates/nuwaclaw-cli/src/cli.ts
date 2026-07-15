import { createProgram } from "./cli/createProgram.js";
import { initDebugLogging } from "./core/debugLog.js";

initDebugLogging();
await createProgram().parseAsync(process.argv);
