export interface CLIArgs {
  owner: string;
  repo: string;
  pullNumber: number;
  dryRun: boolean;
}

const USAGE = "Usage: --owner <owner> --repo <repo> --pr <number> [--dry-run]";

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export function parseArgs(argv: string[]): CLIArgs {
  let owner: string | undefined;
  let repo: string | undefined;
  let pr: string | undefined;
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--owner":
        owner = argv[++i];
        break;
      case "--repo":
        repo = argv[++i];
        break;
      case "--pr":
        pr = argv[++i];
        break;
      case "--dry-run":
        dryRun = true;
        break;
    }
  }

  const missing: string[] = [];
  if (!owner) missing.push("--owner");
  if (!repo) missing.push("--repo");
  if (!pr) missing.push("--pr");

  if (missing.length > 0) {
    throw new UsageError(`Missing required arguments: ${missing.join(", ")}\n${USAGE}`);
  }

  const pullNumber = Number(pr);
  if (!Number.isInteger(pullNumber) || pullNumber <= 0) {
    throw new UsageError(`--pr must be a positive integer\n${USAGE}`);
  }

  return { owner: owner!, repo: repo!, pullNumber, dryRun };
}
