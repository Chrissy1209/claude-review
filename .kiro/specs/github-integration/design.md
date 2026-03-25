# Design Document: GitHub Integration

## Overview

此功能為現有的 AI code review 工具新增 GitHub 整合能力。目前 `index.ts` 使用 hardcoded `SAMPLE_DIFF`；整合後，工具將透過 GitHub REST API 取得真實 PR 的 diff，交由現有的 `parseDiff` + `reviewCode` 管線處理，最後將審查結果以 PR Review 的形式發布回 GitHub。

整體架構維持現有的模組邊界，新增三個模組：
- `github-client.ts` — 封裝所有 GitHub API 呼叫
- `cli.ts` — 解析命令列參數
- `orchestrator.ts` — 串接完整管線，取代現有的 `main()` in `index.ts`

---

## Architecture

```mermaid
flowchart TD
    CLI["cli.ts\n(parse args)"]
    ORCH["orchestrator.ts\n(pipeline)"]
    GH["github-client.ts\n(GitHub API)"]
    PARSER["diff-parser.ts\n(existing)"]
    REVIEWER["reviewer.ts\n(existing)"]

    CLI -->|PRIdentifier + flags| ORCH
    ORCH -->|fetchDiff| GH
    GH -->|raw diff string| ORCH
    ORCH -->|parseDiff| PARSER
    PARSER -->|FileDiff[]| ORCH
    ORCH -->|reviewCode| REVIEWER
    REVIEWER -->|ReviewResult| ORCH
    ORCH -->|publishReview| GH
```

### 資料流

1. `cli.ts` 解析 `--owner`, `--repo`, `--pr`, `--dry-run` 參數
2. `orchestrator.ts` 依序執行：fetch → parse → review → publish
3. `github-client.ts` 負責所有 HTTP 呼叫，不含業務邏輯
4. `--dry-run` 時跳過 publish 步驟，直接呼叫 `printResult`

---

## Components and Interfaces

### `github-client.ts`

```typescript
export interface PRIdentifier {
  owner: string;
  repo: string;
  pullNumber: number;
}

export interface GitHubReviewPayload {
  body: string;
  event: "APPROVE" | "REQUEST_CHANGES";
  comments: GitHubInlineComment[];
}

export interface GitHubInlineComment {
  path: string;
  line: number;
  body: string;
}

export interface GitHubClient {
  fetchPRDiff(pr: PRIdentifier): Promise<string>;
  publishReview(pr: PRIdentifier, payload: GitHubReviewPayload): Promise<string>; // returns review URL
}

export function createGitHubClient(token: string): GitHubClient;
```

### `cli.ts`

```typescript
export interface CLIArgs {
  owner: string;
  repo: string;
  pullNumber: number;
  dryRun: boolean;
}

export function parseArgs(argv: string[]): CLIArgs; // throws UsageError on missing args
```

### `orchestrator.ts`

```typescript
export async function runPipeline(args: CLIArgs): Promise<void>;
```

內部步驟：
1. 驗證環境變數 (`GITHUB_TOKEN`, `ANTHROPIC_API_KEY`)
2. `fetchPRDiff` → raw diff string
3. `parseDiff` → `FileDiff[]`
4. `reviewCode` → `ReviewResult`
5. 若 `--dry-run`：`printResult` 並結束；否則 `publishReview`

### 更新 `index.ts`

`index.ts` 改為 entry point，只負責呼叫 `parseArgs` 與 `runPipeline`，移除 `SAMPLE_DIFF` 與舊的 `main()`。

---

## Data Models

### `PRIdentifier`

| 欄位 | 型別 | 說明 |
|------|------|------|
| `owner` | `string` | GitHub 使用者或組織名稱 |
| `repo` | `string` | 倉庫名稱 |
| `pullNumber` | `number` | PR 編號 |

### `GitHubInlineComment`

| 欄位 | 型別 | 說明 |
|------|------|------|
| `path` | `string` | 檔案路徑（相對於 repo root） |
| `line` | `number` | 行號（PR diff 中的新行號） |
| `body` | `string` | 評論內容 |

### `GitHubReviewPayload`

| 欄位 | 型別 | 說明 |
|------|------|------|
| `body` | `string` | PR Review 整體摘要 |
| `event` | `"APPROVE" \| "REQUEST_CHANGES"` | 審查決定 |
| `comments` | `GitHubInlineComment[]` | 行內評論列表 |

### `CLIArgs`

| 欄位 | 型別 | 說明 |
|------|------|------|
| `owner` | `string` | `--owner` 參數 |
| `repo` | `string` | `--repo` 參數 |
| `pullNumber` | `number` | `--pr` 參數（轉為 number） |
| `dryRun` | `boolean` | `--dry-run` flag |

### `ReviewResult` → `GitHubReviewPayload` 映射規則

- `ReviewResult.summary` → `payload.body`
- `ReviewResult.approved === true` → `payload.event = "APPROVE"`
- `ReviewResult.approved === false` → `payload.event = "REQUEST_CHANGES"`
- `ReviewResult.comments` 中有 `line` 的項目 → `payload.comments`（`filename` → `path`，`message + suggestion` → `body`）
- 沒有 `line` 的評論附加到 `payload.body` 尾端


---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Authorization header always carries the token

*For any* GitHub token string, every HTTP request made by `GitHubClient` must include an `Authorization: Bearer <token>` header matching that token.

**Validates: Requirements 1.1, 1.4**

---

### Property 2: Invalid token produces auth error distinct from other errors

*For any* GitHub API call that receives a 401 HTTP response, the `GitHubClient` must throw an error that is identifiable as an authentication error (e.g., contains "authentication" or "401" in the message), distinct from errors produced by 404 or 5xx responses.

**Validates: Requirements 1.3**

---

### Property 3: Fetch diff returns raw string for valid PR

*For any* valid `PRIdentifier` and a mocked 200 response containing a diff string, `fetchPRDiff` must return that exact diff string unchanged.

**Validates: Requirements 2.1, 2.5**

---

### Property 4: CLI correctly parses all valid argument combinations

*For any* non-empty `owner` string, non-empty `repo` string, and positive integer `pullNumber`, `parseArgs` called with `["--owner", owner, "--repo", repo, "--pr", String(pullNumber)]` must return a `CLIArgs` with those exact values and `dryRun: false`.

**Validates: Requirements 2.2, 5.1**

---

### Property 5: Repository or PR not found produces error containing the identifier

*For any* `PRIdentifier`, if the GitHub API returns 404, the thrown error message must contain either the repository name (owner/repo) or the PR number, depending on which resource was not found.

**Validates: Requirements 2.3, 2.4**

---

### Property 6: Diff fetch request uses correct Accept header

*For any* `PRIdentifier`, the HTTP request made by `fetchPRDiff` must include the header `Accept: application/vnd.github.v3.diff`.

**Validates: Requirements 2.6**

---

### Property 7: All line-bearing comments appear as inline review comments

*For any* `ReviewResult` whose `comments` array contains entries with a `line` field, every such comment must appear in the `GitHubReviewPayload.comments` array with the correct `path` and `line` values.

**Validates: Requirements 3.2**

---

### Property 8: Review summary is always the payload body

*For any* `ReviewResult`, the `summary` field must appear verbatim as the `body` field of the constructed `GitHubReviewPayload`.

**Validates: Requirements 3.3**

---

### Property 9: Approved flag maps correctly to review event

*For any* `ReviewResult`, if `approved` is `true` the payload event must be `"APPROVE"`, and if `approved` is `false` the payload event must be `"REQUEST_CHANGES"`.

**Validates: Requirements 3.4, 3.5**

---

### Property 10: Successful publish returns and outputs the review URL

*For any* successful GitHub API response that includes a review URL, `publishReview` must return that URL string and it must be printed to the console.

**Validates: Requirements 3.7**

---

### Property 11: Pipeline completes for any valid inputs

*For any* valid `CLIArgs` with mocked dependencies that all succeed, `runPipeline` must resolve without throwing and must invoke fetch, parse, review, and publish exactly once each.

**Validates: Requirements 4.2**

---

### Property 12: Pipeline failure propagates step context

*For any* pipeline step (fetch / parse / review / publish) that throws an error, `runPipeline` must re-throw or exit with a message that identifies the failing step name and includes the original error message.

**Validates: Requirements 4.3**

---

### Property 13: Missing required CLI arguments always produce a usage error

*For any* subset of `{--owner, --repo, --pr}` that is missing at least one argument, `parseArgs` must throw a `UsageError` whose message contains the correct usage format string.

**Validates: Requirements 5.2**

---

## Error Handling

| 狀況 | 處理方式 |
|------|----------|
| `GITHUB_TOKEN` 未設定 | `orchestrator` 在啟動時檢查，印出明確錯誤訊息後 `process.exit(1)` |
| `ANTHROPIC_API_KEY` 未設定 | 同上 |
| GitHub API 401 | `GitHubClient` 拋出 `AuthError`，orchestrator 捕捉並印出「認證失敗」訊息 |
| GitHub API 404 (repo) | 拋出含 repo 名稱的錯誤 |
| GitHub API 404 (PR) | 拋出含 PR 編號的錯誤 |
| GitHub API 5xx | 拋出含 HTTP 狀態碼的通用 API 錯誤 |
| 發布 review 失敗 | 印出錯誤詳情，`process.exit(1)` |
| CLI 缺少必要參數 | 拋出 `UsageError`，印出 usage 訊息，`process.exit(1)` |
| `parseDiff` 回傳空陣列 | orchestrator 印出警告並繼續（空 diff 仍可送審） |

所有錯誤均在 `orchestrator.ts` 的頂層 try/catch 統一處理，確保 exit code 正確。

---

## Testing Strategy

### 雙軌測試方法

**Unit tests** 驗證具體範例、邊界條件與錯誤路徑；**property-based tests** 驗證對所有輸入均成立的普遍性質。兩者互補，缺一不可。

### Unit Tests（具體範例）

- `GITHUB_TOKEN` 未設定時 orchestrator 印出正確錯誤並退出
- 管線步驟依序執行（fetch → parse → review → publish）
- `--dry-run` 時不呼叫 `publishReview`，改呼叫 `printResult`
- 進度訊息在每個步驟印出

### Property-Based Tests

使用 **[fast-check](https://github.com/dubzzz/fast-check)**（TypeScript/JavaScript 的 PBT 函式庫）。

每個 property test 至少執行 **100 次迭代**。

每個測試以 tag 標記對應的設計屬性：

```
// Feature: github-integration, Property N: <property_text>
```

| Property | 測試描述 | fast-check arbitraries |
|----------|----------|------------------------|
| P1 | Authorization header 攜帶 token | `fc.string()` for token |
| P2 | 401 回應產生 auth error | `fc.string()` for token |
| P3 | fetchPRDiff 回傳原始 diff | `fc.record({owner, repo, pullNumber})` + mock |
| P4 | CLI 正確解析所有有效參數組合 | `fc.string()`, `fc.integer({min:1})` |
| P5 | 404 錯誤訊息含識別資訊 | `fc.record({owner, repo, pullNumber})` |
| P6 | fetch 請求使用正確 Accept header | `fc.record({owner, repo, pullNumber})` |
| P7 | 有行號的評論出現在 inline comments | `fc.array(fc.record({...}))` for ReviewResult |
| P8 | summary 成為 payload body | `fc.string()` for summary |
| P9 | approved 正確映射到 event | `fc.boolean()` for approved |
| P10 | 成功發布回傳並輸出 URL | `fc.webUrl()` for review URL |
| P11 | 有效輸入下管線完整執行 | `fc.record({owner, repo, pullNumber})` |
| P12 | 管線失敗時傳遞步驟資訊 | `fc.string()` for error message |
| P13 | 缺少必要參數產生 usage error | `fc.subarray(["--owner","--repo","--pr"])` |

### 測試工具

- **Test runner**: `vitest` (ESM-native，與現有 `tsx` 工具鏈相容)
- **PBT library**: `fast-check`
- **HTTP mocking**: `vitest` 的 `vi.spyOn` / `vi.fn()` mock `fetch`
- **執行指令**: `vitest --run`（單次執行，不進入 watch mode）
