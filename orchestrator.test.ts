import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fc from "fast-check";
import { mapToPayload, runPipeline } from "./orchestrator.js";
import type { ReviewResult, ReviewComment } from "./reviewer.js";
import type { CLIArgs } from "./cli.js";

// ---- Arbitraries ----

const arbSeverity = fc.constantFrom("info" as const, "warning" as const, "error" as const);
const arbCategory = fc.constantFrom(
  "security" as const,
  "logic" as const,
  "quality" as const,
  "style" as const
);

const arbCommentWithLine = fc.record({
  filename: fc.string({ minLength: 1 }),
  line: fc.integer({ min: 1, max: 10000 }),
  severity: arbSeverity,
  category: arbCategory,
  message: fc.string({ minLength: 1 }),
  suggestion: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
}) as fc.Arbitrary<ReviewComment>;

const arbCommentNoLine = fc.record({
  filename: fc.string({ minLength: 1 }),
  severity: arbSeverity,
  category: arbCategory,
  message: fc.string({ minLength: 1 }),
  suggestion: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
}) as fc.Arbitrary<ReviewComment>;

const arbReviewResult = fc.record({
  riskLevel: fc.constantFrom("low" as const, "medium" as const, "high" as const),
  summary: fc.string({ minLength: 1 }),
  approved: fc.boolean(),
  comments: fc.array(fc.oneof(arbCommentWithLine, arbCommentNoLine)),
}) satisfies fc.Arbitrary<ReviewResult>;

const arbCLIArgs = fc.record({
  owner: fc.string({ minLength: 1 }),
  repo: fc.string({ minLength: 1 }),
  pullNumber: fc.integer({ min: 1 }),
  dryRun: fc.boolean(),
}) satisfies fc.Arbitrary<CLIArgs>;

// ---- Unit tests for mapToPayload ----

describe("mapToPayload", () => {
  it("maps summary to payload body", () => {
    const result: ReviewResult = {
      riskLevel: "low",
      summary: "Looks good",
      approved: true,
      comments: [],
    };
    const payload = mapToPayload(result);
    expect(payload.body).toBe("Looks good");
  });

  it("maps approved=true to APPROVE event", () => {
    const result: ReviewResult = {
      riskLevel: "low",
      summary: "ok",
      approved: true,
      comments: [],
    };
    expect(mapToPayload(result).event).toBe("APPROVE");
  });

  it("maps approved=false to REQUEST_CHANGES event", () => {
    const result: ReviewResult = {
      riskLevel: "high",
      summary: "issues found",
      approved: false,
      comments: [],
    };
    expect(mapToPayload(result).event).toBe("REQUEST_CHANGES");
  });

  it("maps line-bearing comments to inline comments", () => {
    const result: ReviewResult = {
      riskLevel: "medium",
      summary: "review",
      approved: false,
      comments: [
        {
          filename: "src/foo.ts",
          line: 42,
          severity: "error",
          category: "security",
          message: "SQL injection",
          suggestion: "Use parameterized queries",
        },
      ],
    };
    const payload = mapToPayload(result);
    expect(payload.comments).toHaveLength(1);
    expect(payload.comments[0].path).toBe("src/foo.ts");
    expect(payload.comments[0].line).toBe(42);
    expect(payload.comments[0].body).toContain("SQL injection");
    expect(payload.comments[0].body).toContain("Use parameterized queries");
  });

  it("appends no-line comments to body", () => {
    const result: ReviewResult = {
      riskLevel: "low",
      summary: "Summary text",
      approved: true,
      comments: [
        {
          filename: "src/bar.ts",
          severity: "info",
          category: "style",
          message: "General style note",
        },
      ],
    };
    const payload = mapToPayload(result);
    expect(payload.comments).toHaveLength(0);
    expect(payload.body).toContain("Summary text");
    expect(payload.body).toContain("General style note");
  });
});

// ---- Property-Based Tests ----

// Feature: github-integration, Property 7: All line-bearing comments appear as inline review comments
describe("P7: All line-bearing comments appear as inline review comments", () => {
  it("every comment with a line appears in payload.comments with correct path and line", () => {
    // Validates: Requirements 3.2
    fc.assert(
      fc.property(arbReviewResult, (result) => {
        const lineComments = result.comments.filter((c) => c.line != null);
        const payload = mapToPayload(result);

        for (const c of lineComments) {
          const found = payload.comments.find(
            (pc) => pc.path === c.filename && pc.line === c.line
          );
          expect(found).toBeDefined();
        }
        // No extra inline comments from no-line entries
        expect(payload.comments.length).toBe(lineComments.length);
      }),
      { numRuns: 100 }
    );
  });
});

// Feature: github-integration, Property 8: Review summary is always the payload body
describe("P8: Review summary is always the payload body", () => {
  it("summary appears verbatim at the start of payload.body", () => {
    // Validates: Requirements 3.3
    fc.assert(
      fc.property(arbReviewResult, (result) => {
        const payload = mapToPayload(result);
        expect(payload.body.startsWith(result.summary)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });
});

// Feature: github-integration, Property 9: Approved flag maps correctly to review event
describe("P9: Approved flag maps correctly to review event", () => {
  it("approved=true → APPROVE, approved=false → REQUEST_CHANGES", () => {
    // Validates: Requirements 3.4, 3.5
    fc.assert(
      fc.property(arbReviewResult, (result) => {
        const payload = mapToPayload(result);
        if (result.approved) {
          expect(payload.event).toBe("APPROVE");
        } else {
          expect(payload.event).toBe("REQUEST_CHANGES");
        }
      }),
      { numRuns: 100 }
    );
  });
});

// ---- Pipeline tests (P11, P12) with mocked dependencies ----

// We mock the modules used by runPipeline
vi.mock("./github-client.js", () => ({
  createGitHubClient: vi.fn(),
}));

vi.mock("./diff-parser.js", () => ({
  parseDiff: vi.fn(),
}));

vi.mock("./reviewer.js", () => ({
  reviewCode: vi.fn(),
}));

import { createGitHubClient } from "./github-client.js";
import { parseDiff } from "./diff-parser.js";
import { reviewCode } from "./reviewer.js";

const mockCreateGitHubClient = vi.mocked(createGitHubClient);
const mockParseDiff = vi.mocked(parseDiff);
const mockReviewCode = vi.mocked(reviewCode);

function makeMockClient(overrides?: {
  fetchPRDiff?: () => Promise<string>;
  publishReview?: () => Promise<string>;
}) {
  return {
    fetchPRDiff: overrides?.fetchPRDiff ?? vi.fn().mockResolvedValue("diff content"),
    publishReview: overrides?.publishReview ?? vi.fn().mockResolvedValue("https://github.com/review/1"),
  };
}

const defaultReviewResult: ReviewResult = {
  riskLevel: "low",
  summary: "All good",
  approved: true,
  comments: [],
};

describe("runPipeline", () => {
  let originalEnv: NodeJS.ProcessEnv;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.GITHUB_TOKEN = "test-token";
    process.env.ANTHROPIC_API_KEY = "test-api-key";

    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as never);
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    mockParseDiff.mockReturnValue([]);
    mockReviewCode.mockResolvedValue(defaultReviewResult);
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("exits with error when GITHUB_TOKEN is missing", async () => {
    delete process.env.GITHUB_TOKEN;
    const args: CLIArgs = { owner: "o", repo: "r", pullNumber: 1, dryRun: false };

    await expect(runPipeline(args)).rejects.toThrow("process.exit called");
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("GITHUB_TOKEN"));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with error when ANTHROPIC_API_KEY is missing", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const args: CLIArgs = { owner: "o", repo: "r", pullNumber: 1, dryRun: false };

    await expect(runPipeline(args)).rejects.toThrow("process.exit called");
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("ANTHROPIC_API_KEY"));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("calls fetch, parse, review, publish in sequence for non-dry-run", async () => {
    const mockClient = makeMockClient();
    mockCreateGitHubClient.mockReturnValue(mockClient);

    const args: CLIArgs = { owner: "owner", repo: "repo", pullNumber: 42, dryRun: false };
    await runPipeline(args);

    expect(mockClient.fetchPRDiff).toHaveBeenCalledWith({ owner: "owner", repo: "repo", pullNumber: 42 });
    expect(mockParseDiff).toHaveBeenCalled();
    expect(mockReviewCode).toHaveBeenCalled();
    expect(mockClient.publishReview).toHaveBeenCalled();
  });

  it("skips publishReview and calls printResult in dry-run mode", async () => {
    const mockClient = makeMockClient();
    mockCreateGitHubClient.mockReturnValue(mockClient);

    const args: CLIArgs = { owner: "owner", repo: "repo", pullNumber: 1, dryRun: true };
    await runPipeline(args);

    expect(mockClient.fetchPRDiff).toHaveBeenCalled();
    expect(mockReviewCode).toHaveBeenCalled();
    expect(mockClient.publishReview).not.toHaveBeenCalled();
  });
});

// Feature: github-integration, Property 11: Pipeline completes for any valid inputs
describe("P11: Pipeline completes for any valid inputs", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.GITHUB_TOKEN = "test-token";
    process.env.ANTHROPIC_API_KEY = "test-api-key";
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as never);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves without throwing for any valid CLIArgs when all deps succeed", async () => {
    // Validates: Requirements 4.2
    await fc.assert(
      fc.asyncProperty(arbCLIArgs, async (args) => {
        const mockClient = makeMockClient();
        mockCreateGitHubClient.mockReturnValue(mockClient);
        mockParseDiff.mockReturnValue([]);
        mockReviewCode.mockResolvedValue(defaultReviewResult);

        await expect(runPipeline(args)).resolves.toBeUndefined();

        // fetch and review always called once
        expect(mockClient.fetchPRDiff).toHaveBeenCalledTimes(1);
        expect(mockReviewCode).toHaveBeenCalledTimes(1);

        // publish called iff not dry-run
        if (!args.dryRun) {
          expect(mockClient.publishReview).toHaveBeenCalledTimes(1);
        } else {
          expect(mockClient.publishReview).not.toHaveBeenCalled();
        }

        vi.clearAllMocks();
      }),
      { numRuns: 50 }
    );
  });
});

// Feature: github-integration, Property 12: Pipeline failure propagates step context
describe("P12: Pipeline failure propagates step context", () => {
  beforeEach(() => {
    process.env.GITHUB_TOKEN = "test-token";
    process.env.ANTHROPIC_API_KEY = "test-api-key";
    vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as never);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("error message contains step name and original error for any failing step", async () => {
    // Validates: Requirements 4.3
    const steps = ["fetch", "parse", "review", "publish"] as const;

    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...steps),
        fc.string({ minLength: 1 }),
        async (failingStep, errorMsg) => {
          const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

          const mockClient = {
            fetchPRDiff:
              failingStep === "fetch"
                ? vi.fn().mockRejectedValue(new Error(errorMsg))
                : vi.fn().mockResolvedValue("diff"),
            publishReview:
              failingStep === "publish"
                ? vi.fn().mockRejectedValue(new Error(errorMsg))
                : vi.fn().mockResolvedValue("https://github.com/review/1"),
          };
          mockCreateGitHubClient.mockReturnValue(mockClient);

          if (failingStep === "parse") {
            mockParseDiff.mockImplementation(() => {
              throw new Error(errorMsg);
            });
          } else {
            mockParseDiff.mockReturnValue([]);
          }

          if (failingStep === "review") {
            mockReviewCode.mockRejectedValue(new Error(errorMsg));
          } else {
            mockReviewCode.mockResolvedValue(defaultReviewResult);
          }

          const args: CLIArgs = {
            owner: "o",
            repo: "r",
            pullNumber: 1,
            dryRun: failingStep === "publish" ? false : false,
          };

          await expect(runPipeline(args)).rejects.toThrow("process.exit called");

          const errorCall = consoleErrorSpy.mock.calls[0]?.[0] as string;
          expect(errorCall).toContain(failingStep);
          expect(errorCall).toContain(errorMsg);

          vi.clearAllMocks();
          // restore parseDiff default
          mockParseDiff.mockReturnValue([]);
          mockReviewCode.mockResolvedValue(defaultReviewResult);
        }
      ),
      { numRuns: 50 }
    );
  });
});
