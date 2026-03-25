import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { parseArgs, UsageError } from "./cli.ts";

describe("parseArgs - unit tests", () => {
  it("parses all required arguments", () => {
    const result = parseArgs(["--owner", "octocat", "--repo", "hello-world", "--pr", "42"]);
    expect(result).toEqual({ owner: "octocat", repo: "hello-world", pullNumber: 42, dryRun: false });
  });

  it("parses --dry-run flag", () => {
    const result = parseArgs(["--owner", "octocat", "--repo", "hello-world", "--pr", "1", "--dry-run"]);
    expect(result.dryRun).toBe(true);
  });

  it("throws UsageError when --owner is missing", () => {
    expect(() => parseArgs(["--repo", "hello-world", "--pr", "1"])).toThrow(UsageError);
  });

  it("throws UsageError when --repo is missing", () => {
    expect(() => parseArgs(["--owner", "octocat", "--pr", "1"])).toThrow(UsageError);
  });

  it("throws UsageError when --pr is missing", () => {
    expect(() => parseArgs(["--owner", "octocat", "--repo", "hello-world"])).toThrow(UsageError);
  });

  it("throws UsageError when all arguments are missing", () => {
    expect(() => parseArgs([])).toThrow(UsageError);
  });

  it("UsageError message contains usage format", () => {
    try {
      parseArgs([]);
    } catch (e) {
      expect(e).toBeInstanceOf(UsageError);
      expect((e as UsageError).message).toContain("--owner");
      expect((e as UsageError).message).toContain("--repo");
      expect((e as UsageError).message).toContain("--pr");
    }
  });
});

describe("parseArgs - property-based tests", () => {
  // Feature: github-integration, Property 4: CLI correctly parses all valid argument combinations
  it("P4: correctly parses all valid argument combinations", () => {
    // Validates: Requirements 2.2, 5.1
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        fc.integer({ min: 1 }),
        (owner, repo, pullNumber) => {
          const result = parseArgs([
            "--owner", owner,
            "--repo", repo,
            "--pr", String(pullNumber),
          ]);
          expect(result.owner).toBe(owner);
          expect(result.repo).toBe(repo);
          expect(result.pullNumber).toBe(pullNumber);
          expect(result.dryRun).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: github-integration, Property 13: Missing required CLI arguments always produce a usage error
  it("P13: missing required arguments always produce a UsageError with usage format", () => {
    // Validates: Requirements 5.2
    const requiredArgs = ["--owner", "--repo", "--pr"] as const;
    const validValues: Record<string, string> = {
      "--owner": "octocat",
      "--repo": "hello-world",
      "--pr": "1",
    };

    fc.assert(
      fc.property(
        fc.subarray(requiredArgs, { minLength: 1 }),
        (missingArgs) => {
          // Build argv with only the non-missing required args
          const argv: string[] = [];
          for (const arg of requiredArgs) {
            if (!missingArgs.includes(arg)) {
              argv.push(arg, validValues[arg]);
            }
          }

          expect(() => parseArgs(argv)).toThrow(UsageError);

          try {
            parseArgs(argv);
          } catch (e) {
            expect(e).toBeInstanceOf(UsageError);
            // Message must contain the usage format string
            expect((e as UsageError).message).toMatch(/--owner.*--repo.*--pr|Usage:/);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
