# Implementation Plan: GitHub Integration

## Overview

以 TypeScript 實作 GitHub 整合功能，新增 `github-client.ts`、`cli.ts`、`orchestrator.ts` 三個模組，並更新 `index.ts` 作為新的 entry point。測試工具使用 vitest + fast-check。

## Tasks

- [x] 1. 建立 github-client.ts 與核心介面
  - 定義並匯出 `PRIdentifier`、`GitHubInlineComment`、`GitHubReviewPayload`、`GitHubClient` 介面
  - 實作 `createGitHubClient(token)` factory function，使用 `fetch` 呼叫 GitHub REST API
  - `fetchPRDiff`：使用 `Accept: application/vnd.github.v3.diff` header，處理 401/404/5xx 錯誤
  - `publishReview`：呼叫 PR Review API，回傳 review URL
  - 定義 `AuthError` class 以區分認證錯誤與其他 API 錯誤
  - _Requirements: 1.1, 1.3, 1.4, 2.1, 2.3, 2.4, 2.6, 3.1, 3.6, 3.7_

  - [ ]* 1.1 為 Authorization header 撰寫 property test
    - **Property 1: Authorization header always carries the token**
    - **Validates: Requirements 1.1, 1.4**

  - [ ]* 1.2 為 401 回應撰寫 property test
    - **Property 2: Invalid token produces auth error distinct from other errors**
    - **Validates: Requirements 1.3**

  - [ ]* 1.3 為 fetchPRDiff 回傳值撰寫 property test
    - **Property 3: Fetch diff returns raw string for valid PR**
    - **Validates: Requirements 2.1, 2.5**

  - [ ]* 1.4 為 404 錯誤訊息撰寫 property test
    - **Property 5: Repository or PR not found produces error containing the identifier**
    - **Validates: Requirements 2.3, 2.4**

  - [ ]* 1.5 為 Accept header 撰寫 property test
    - **Property 6: Diff fetch request uses correct Accept header**
    - **Validates: Requirements 2.6**

  - [ ]* 1.6 為 publishReview 回傳 URL 撰寫 property test
    - **Property 10: Successful publish returns and outputs the review URL**
    - **Validates: Requirements 3.7**

- [x] 2. 建立 cli.ts 參數解析模組
  - 定義並匯出 `CLIArgs` 介面與 `UsageError` class
  - 實作 `parseArgs(argv)`：解析 `--owner`、`--repo`、`--pr`、`--dry-run`
  - 缺少任何必要參數時拋出 `UsageError`，訊息包含正確 usage 格式
  - _Requirements: 2.2, 5.1, 5.2_

  - [ ]* 2.1 為 CLI 參數解析撰寫 property test
    - **Property 4: CLI correctly parses all valid argument combinations**
    - **Validates: Requirements 2.2, 5.1**

  - [ ]* 2.2 為缺少必要參數撰寫 property test
    - **Property 13: Missing required CLI arguments always produce a usage error**
    - **Validates: Requirements 5.2**

- [x] 3. Checkpoint — 確認所有測試通過
  - 確認所有測試通過，如有問題請提出。

- [x] 4. 建立 orchestrator.ts 管線模組
  - 實作 `runPipeline(args: CLIArgs)`，依序執行：驗證環境變數 → fetch → parse → review → publish
  - 啟動時檢查 `GITHUB_TOKEN` 與 `ANTHROPIC_API_KEY`，缺少時印出明確錯誤並 `process.exit(1)`
  - 每個步驟印出進度訊息
  - `--dry-run` 時跳過 `publishReview`，改呼叫 `printResult`
  - 頂層 try/catch 捕捉所有錯誤，印出步驟名稱與錯誤訊息後 `process.exit(1)`
  - 實作 `ReviewResult` → `GitHubReviewPayload` 的映射邏輯（含無行號評論附加到 body）
  - _Requirements: 1.2, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 4.4, 5.3, 5.4_

  - [ ]* 4.1 為有行號評論映射撰寫 property test
    - **Property 7: All line-bearing comments appear as inline review comments**
    - **Validates: Requirements 3.2**

  - [ ]* 4.2 為 summary 映射撰寫 property test
    - **Property 8: Review summary is always the payload body**
    - **Validates: Requirements 3.3**

  - [ ]* 4.3 為 approved 映射撰寫 property test
    - **Property 9: Approved flag maps correctly to review event**
    - **Validates: Requirements 3.4, 3.5**

  - [ ]* 4.4 為完整管線執行撰寫 property test
    - **Property 11: Pipeline completes for any valid inputs**
    - **Validates: Requirements 4.2**

  - [ ]* 4.5 為管線失敗傳遞步驟資訊撰寫 property test
    - **Property 12: Pipeline failure propagates step context**
    - **Validates: Requirements 4.3**

- [x] 5. 更新 index.ts 為新的 entry point
  - 移除 `SAMPLE_DIFF` 與舊的 `main()` 函式
  - 改為呼叫 `parseArgs(process.argv.slice(2))` 與 `runPipeline(args)`
  - 在頂層處理 `UsageError`：印出 usage 訊息並 `process.exit(1)`
  - _Requirements: 5.1, 5.2_

- [x] 6. Final Checkpoint — 確認所有測試通過
  - 確認所有測試通過，如有問題請提出。

## Notes

- 標記 `*` 的子任務為選填，可跳過以加速 MVP 開發
- 每個任務均對應具體需求編號以利追蹤
- Property tests 使用 fast-check，每個 property 至少執行 100 次迭代
- 每個 property test 加上 tag 註解：`// Feature: github-integration, Property N: <property_text>`
- HTTP mocking 使用 vitest 的 `vi.spyOn` / `vi.fn()` mock `fetch`
- 執行測試：`vitest --run`
