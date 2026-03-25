# Requirements Document

## Introduction

為現有的 AI code review 工具新增 GitHub 整合功能。目前工具使用 hardcoded sample diff，此功能將使工具能夠連接真實的 GitHub Pull Request，讀取實際的 PR diff，並將 Claude 的審查結果以 review comment 的形式自動發布回 GitHub PR。

## Glossary

- **GitHub_Client**: 負責與 GitHub REST API 溝通的模組，包含讀取 PR diff 與發布 review comment 的能力
- **PR_Fetcher**: 負責從 GitHub 取得指定 PR 的 diff 內容的元件
- **Comment_Publisher**: 負責將審查結果轉換並發布為 GitHub PR review comment 的元件
- **Review_Orchestrator**: 協調整個流程的主控元件，串接 PR_Fetcher、現有的 Reviewer 與 Comment_Publisher
- **GitHub_Token**: 用於驗證 GitHub API 請求的個人存取權杖（Personal Access Token）
- **PR_Identifier**: 由 owner（擁有者）、repo（倉庫名稱）、pull_number（PR 編號）組成的三元組，唯一識別一個 Pull Request
- **Review_Comment**: 發布到 GitHub PR 上的審查意見，可附加到特定檔案的特定行
- **PR_Review**: GitHub 上的整體審查提交，包含整體意見（summary）與多個 Review_Comment，以及 APPROVE 或 REQUEST_CHANGES 的審查決定

---

## Requirements

### Requirement 1: GitHub 身份驗證

**User Story:** As a developer, I want to authenticate with GitHub using a Personal Access Token, so that the tool can access private repositories and post review comments on my behalf.

#### Acceptance Criteria

1. THE GitHub_Client SHALL read the GitHub_Token from the `GITHUB_TOKEN` environment variable
2. IF the `GITHUB_TOKEN` environment variable is not set, THEN THE Review_Orchestrator SHALL exit with a descriptive error message indicating the missing token
3. IF the GitHub_Token is invalid or expired, THEN THE GitHub_Client SHALL return an authentication error with a clear message distinguishing it from other API errors
4. THE GitHub_Client SHALL include the GitHub_Token in the `Authorization` header of every GitHub API request using the `Bearer` scheme

---

### Requirement 2: 讀取 PR Diff

**User Story:** As a developer, I want the tool to fetch the actual diff of a GitHub Pull Request, so that Claude can review real code changes instead of hardcoded samples.

#### Acceptance Criteria

1. WHEN a PR_Identifier is provided, THE PR_Fetcher SHALL fetch the diff content of the specified Pull Request from the GitHub API
2. THE PR_Fetcher SHALL accept the PR_Identifier as command-line arguments in the format `--owner <owner> --repo <repo> --pr <number>`
3. IF the specified repository does not exist or is inaccessible, THEN THE PR_Fetcher SHALL return an error message specifying the repository name
4. IF the specified pull_number does not exist in the repository, THEN THE PR_Fetcher SHALL return an error message specifying the PR number
5. WHEN the PR diff is successfully fetched, THE PR_Fetcher SHALL pass the raw diff string to the existing `parseDiff` function for parsing
6. THE PR_Fetcher SHALL request the diff using the `application/vnd.github.v3.diff` Accept header to receive raw diff format

---

### Requirement 3: 發布 Review Comment 到 GitHub

**User Story:** As a developer, I want the AI review results to be automatically posted as a GitHub PR review, so that the feedback is visible directly in the pull request interface.

#### Acceptance Criteria

1. WHEN a ReviewResult is available, THE Comment_Publisher SHALL create a PR_Review on the specified Pull Request using the GitHub Pull Request Review API
2. THE Comment_Publisher SHALL map each ReviewComment with a line number to a GitHub inline review comment on the corresponding file and line
3. THE Comment_Publisher SHALL include the ReviewResult summary as the body of the PR_Review
4. WHEN `ReviewResult.approved` is `true`, THE Comment_Publisher SHALL submit the PR_Review with the `APPROVE` event
5. WHEN `ReviewResult.approved` is `false`, THE Comment_Publisher SHALL submit the PR_Review with the `REQUEST_CHANGES` event
6. IF the GitHub API returns an error when submitting the review, THEN THE Comment_Publisher SHALL log the error details and exit with a non-zero status code
7. WHEN the PR_Review is successfully submitted, THE Comment_Publisher SHALL output the URL of the submitted review to the console

---

### Requirement 4: 端對端流程整合

**User Story:** As a developer, I want a single command to fetch a PR, review it with Claude, and post the results back to GitHub, so that I can automate code review with minimal manual steps.

#### Acceptance Criteria

1. THE Review_Orchestrator SHALL execute the following steps in sequence: fetch PR diff → parse diff → review with Claude → publish review to GitHub
2. WHEN invoked with a valid PR_Identifier and both `ANTHROPIC_API_KEY` and `GITHUB_TOKEN` are set, THE Review_Orchestrator SHALL complete the full pipeline without manual intervention
3. IF any step in the pipeline fails, THEN THE Review_Orchestrator SHALL stop execution, log the step name and error message, and exit with a non-zero status code
4. THE Review_Orchestrator SHALL print progress messages to the console at each pipeline step indicating the current operation

---

### Requirement 5: 命令列介面

**User Story:** As a developer, I want a clear command-line interface to specify which PR to review, so that I can easily integrate the tool into scripts and CI workflows.

#### Acceptance Criteria

1. THE Review_Orchestrator SHALL accept `--owner`, `--repo`, and `--pr` as required command-line arguments
2. IF any required argument is missing, THEN THE Review_Orchestrator SHALL print a usage message showing the correct argument format and exit with a non-zero status code
3. THE Review_Orchestrator SHALL support a `--dry-run` flag that runs the full pipeline including Claude review but skips posting the review to GitHub
4. WHEN `--dry-run` is specified, THE Review_Orchestrator SHALL print the ReviewResult to the console in the same format as the existing `printResult` function
