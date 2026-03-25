# claude-review

一個 AI 驅動的 GitHub PR 自動審查工具，透過 Claude 分析 Pull Request 的 diff，並將審查結果直接發布回 GitHub。

## 功能

- 自動從 GitHub 取得 PR diff
- 使用 Claude 進行程式碼審查，涵蓋安全性、邏輯錯誤、品質與風格
- 將審查結果以 PR Review 形式發布回 GitHub（支援行內評論）
- 支援 `--dry-run` 模式，僅印出審查結果而不發布

## 前置需求

- Node.js 18+
- GitHub Personal Access Token（需有 `repo` 權限）
- Anthropic API Key

## 安裝

```bash
npm install
```

## 環境變數

```bash
export GITHUB_TOKEN=your_github_personal_access_token
export ANTHROPIC_API_KEY=your_anthropic_api_key
```

## 使用方式

```bash
npm start -- --owner <owner> --repo <repo> --pr <number> [--dry-run]
```

### 參數說明

| 參數 | 必填 | 說明 |
|------|------|------|
| `--owner` | ✓ | GitHub 使用者或組織名稱 |
| `--repo` | ✓ | 倉庫名稱 |
| `--pr` | ✓ | Pull Request 編號 |
| `--dry-run` | | 僅印出審查結果，不發布到 GitHub |

### 範例

```bash
# 審查並發布結果到 GitHub
npm start -- --owner octocat --repo hello-world --pr 42

# 僅預覽審查結果
npm start -- --owner octocat --repo hello-world --pr 42 --dry-run
```

## 審查輸出

審查結果包含：

- 整體風險等級（`low` / `medium` / `high`）
- 審查決定（通過 / 需要修改）
- 摘要說明
- 各問題的詳細評論，包含嚴重程度、類別、問題描述與修改建議

問題類別：`security`（安全性）、`logic`（邏輯錯誤）、`quality`（品質）、`style`（風格）

## 執行測試

```bash
npm test
```

## 專案結構

```
├── index.ts          # 程式進入點
├── cli.ts            # 命令列參數解析
├── orchestrator.ts   # 主流程協調（fetch → parse → review → publish）
├── github-client.ts  # GitHub REST API 封裝
├── diff-parser.ts    # Git diff 解析
└── reviewer.ts       # Claude 審查邏輯
```
