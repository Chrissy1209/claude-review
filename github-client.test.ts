import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";
import {
  createGitHubClient,
  AuthError,
  type PRIdentifier,
  type GitHubReviewPayload,
} from "./github-client.js";

// Helper: build a mock fetch that returns a given response
function mockFetch(status: number, body: string | object, headers: Record<string, string> = {}) {
  const isText = typeof body === "string";
  return vi.fn().mockResolvedValue({
    status,
    ok: status >= 200 && status < 300,
    text: () => Promise.resolve(isText ? body : JSON.stringify(body)),
    json: () => Promise.resolve(isText ? JSON.parse(body) : body),
    headers: new Headers(headers),
  });
}

// Arbitraries
const prIdentifierArb = fc.record({
  owner: fc.stringMatching(/^[a-zA-Z0-9_-]{1,20}$/),
  repo: fc.stringMatching(/^[a-zA-Z0-9_-]{1,20}$/),
  pullNumber: fc.integer({ min: 1, max: 99999 }),
});

const tokenArb = fc.string({ minLength: 1, maxLength: 100 });

describe("github-client property tests", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // Feature: github-integration, Property 1: Authorization header always carries the token
  it("P1: Authorization header always carries the token", async () => {
    await fc.assert(
      fc.asyncProperty(tokenArb, prIdentifierArb, async (token, pr) => {
        const captured: RequestInit[] = [];
        const fakeFetch = vi.fn().mockImplementation((url: string, init: RequestInit) => {
          captured.push(init);
          return Promise.resolve({
            status: 200,
            ok: true,
            text: () => Promise.resolve("diff content"),
            json: () => Promise.resolve({}),
          });
        });
        vi.stubGlobal("fetch", fakeFetch);

        const client = createGitHubClient(token);
        await client.fetchPRDiff(pr);

        expect(captured.length).toBeGreaterThan(0);
        const authHeader = (captured[0].headers as Record<string, string>)["Authorization"];
        expect(authHeader).toBe(`Bearer ${token}`);
      }),
      { numRuns: 100 }
    );
  });

  // Feature: github-integration, Property 2: Invalid token produces auth error distinct from other errors
  it("P2: 401 response produces AuthError distinct from other errors", async () => {
    await fc.assert(
      fc.asyncProperty(tokenArb, prIdentifierArb, async (token, pr) => {
        vi.stubGlobal("fetch", mockFetch(401, "Unauthorized"));

        const client = createGitHubClient(token);
        let thrown: unknown;
        try {
          await client.fetchPRDiff(pr);
        } catch (e) {
          thrown = e;
        }

        expect(thrown).toBeInstanceOf(AuthError);
        const msg = (thrown as AuthError).message.toLowerCase();
        expect(msg.includes("authentication") || msg.includes("401")).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  // Feature: github-integration, Property 3: Fetch diff returns raw string for valid PR
  it("P3: fetchPRDiff returns exact diff string for 200 response", async () => {
    const diffArb = fc.string({ minLength: 1, maxLength: 500 });
    await fc.assert(
      fc.asyncProperty(prIdentifierArb, diffArb, async (pr, diffContent) => {
        vi.stubGlobal("fetch", mockFetch(200, diffContent));

        const client = createGitHubClient("test-token");
        const result = await client.fetchPRDiff(pr);

        expect(result).toBe(diffContent);
      }),
      { numRuns: 100 }
    );
  });

  // Feature: github-integration, Property 5: Repository or PR not found produces error containing the identifier
  it("P5: 404 error message contains repo name or PR number", async () => {
    await fc.assert(
      fc.asyncProperty(prIdentifierArb, async (pr) => {
        vi.stubGlobal("fetch", mockFetch(404, "Not Found"));

        const client = createGitHubClient("test-token");
        let thrown: unknown;
        try {
          await client.fetchPRDiff(pr);
        } catch (e) {
          thrown = e;
        }

        expect(thrown).toBeInstanceOf(Error);
        const msg = (thrown as Error).message;
        const containsRepo = msg.includes(pr.repo) || msg.includes(`${pr.owner}/${pr.repo}`);
        const containsPR = msg.includes(String(pr.pullNumber));
        expect(containsRepo || containsPR).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  // Feature: github-integration, Property 6: Diff fetch request uses correct Accept header
  it("P6: fetchPRDiff uses Accept: application/vnd.github.v3.diff header", async () => {
    await fc.assert(
      fc.asyncProperty(prIdentifierArb, async (pr) => {
        const captured: RequestInit[] = [];
        const fakeFetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
          captured.push(init);
          return Promise.resolve({
            status: 200,
            ok: true,
            text: () => Promise.resolve("diff"),
            json: () => Promise.resolve({}),
          });
        });
        vi.stubGlobal("fetch", fakeFetch);

        const client = createGitHubClient("test-token");
        await client.fetchPRDiff(pr);

        const acceptHeader = (captured[0].headers as Record<string, string>)["Accept"];
        expect(acceptHeader).toBe("application/vnd.github.v3.diff");
      }),
      { numRuns: 100 }
    );
  });

  // Feature: github-integration, Property 10: Successful publish returns and outputs the review URL
  it("P10: publishReview returns the review URL from API response", async () => {
    const urlArb = fc.webUrl();
    const payloadArb = fc.record({
      body: fc.string({ minLength: 1 }),
      event: fc.constantFrom("APPROVE" as const, "REQUEST_CHANGES" as const),
      comments: fc.array(
        fc.record({
          path: fc.string({ minLength: 1 }),
          line: fc.integer({ min: 1 }),
          body: fc.string({ minLength: 1 }),
        })
      ),
    });

    await fc.assert(
      fc.asyncProperty(prIdentifierArb, payloadArb, urlArb, async (pr, payload, reviewUrl) => {
        vi.stubGlobal(
          "fetch",
          mockFetch(200, { html_url: reviewUrl, id: 12345 })
        );

        const client = createGitHubClient("test-token");
        const result = await client.publishReview(pr, payload as GitHubReviewPayload);

        expect(result).toBe(reviewUrl);
      }),
      { numRuns: 100 }
    );
  });
});
