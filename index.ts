import { parseArgs, UsageError } from "./cli.js";
import { runPipeline } from "./orchestrator.js";

try {
  const args = parseArgs(process.argv.slice(2));
  await runPipeline(args);
} catch (err) {
  if (err instanceof UsageError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}
