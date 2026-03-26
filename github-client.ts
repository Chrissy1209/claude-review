export interface PRIdentifier {
  owner: string;
  repo: string;
  pullNumber: number;
}

export interface GitHubInlineComment {
  path: string;
  line: number;
  body: string;
}

export interface GitHubReviewPayload {
  body: string;
  event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
  comments: GitHubInlineComment[];
}

export interface GitHubClient {
  fetchPRDiff(pr: PRIdentifier): Promise<string>;
  publishReview(pr: PRIdentifier, payload: GitHubReviewPayload): Promise<string>;
  getExistingReviewComments(pr: PRIdentifier): Promise<string[]>;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export function createGitHubClient(token: string): GitHubClient {
  const baseUrl = "https://api.github.com";

  const headers = {
    Authorization: `Bearer ${token}`,
    "User-Agent": "ai-code-review",
  };

  async function fetchPRDiff(pr: PRIdentifier): Promise<string> {
    const { owner, repo, pullNumber } = pr;
    const url = `${baseUrl}/repos/${owner}/${repo}/pulls/${pullNumber}`;

    const res = await fetch(url, {
      headers: {
        ...headers,
        Accept: "application/vnd.github.v3.diff",
      },
    });

    if (res.status === 401) {
      throw new AuthError(`GitHub authentication failed (401): invalid or expired token`);
    }

    if (res.status === 404) {
      // Try to distinguish repo-not-found vs PR-not-found by checking the error message
      const body = await res.text().catch(() => "");
      const lower = body.toLowerCase();
      if (lower.includes("pull request") || lower.includes("not found")) {
        // Could be either; include both identifiers but lean toward PR number
        throw new Error(`Pull Request #${pullNumber} not found in ${owner}/${repo}`);
      }
      throw new Error(`Repository ${owner}/${repo} not found or inaccessible`);
    }

    if (res.status >= 500) {
      throw new Error(`GitHub API error: HTTP ${res.status}`);
    }

    if (!res.ok) {
      throw new Error(`GitHub API error: HTTP ${res.status}`);
    }

    return res.text();
  }

  async function publishReview(pr: PRIdentifier, payload: GitHubReviewPayload): Promise<string> {
    const { owner, repo, pullNumber } = pr;
    const url = `${baseUrl}/repos/${owner}/${repo}/pulls/${pullNumber}/reviews`;

    const body = {
      body: payload.body,
      event: payload.event,
      comments: payload.comments.map((c) => ({
        path: c.path,
        line: c.line,
        body: c.body,
      })),
    };

    const res = await fetch(url, {
      method: "POST",
      headers: {
        ...headers,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (res.status === 401) {
      throw new AuthError(`GitHub authentication failed (401): invalid or expired token`);
    }

    if (res.status === 404) {
      throw new Error(`Repository ${owner}/${repo} or PR #${pullNumber} not found`);
    }

    if (res.status >= 500) {
      throw new Error(`GitHub API error: HTTP ${res.status}`);
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`GitHub API error: HTTP ${res.status} - ${errText}`);
    }

    const data = (await res.json()) as { html_url?: string; id?: number };
    const reviewUrl =
      data.html_url ??
      `https://github.com/${owner}/${repo}/pull/${pullNumber}#pullrequestreview-${data.id}`;

    return reviewUrl;
  }

  async function getExistingReviewComments(pr: PRIdentifier): Promise<string[]> {
    const { owner, repo, pullNumber } = pr;
    const url = `${baseUrl}/repos/${owner}/${repo}/pulls/${pullNumber}/comments`;
    const res = await fetch(url, {
      headers: { ...headers, Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { body: string }[];
    return data.map((c) => c.body);
  }

  return { fetchPRDiff, publishReview, getExistingReviewComments };
}
