import { createProgram } from "./cli/createProgram.js";

await createProgram().parseAsync(process.argv);
