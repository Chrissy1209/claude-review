import { createGitHubClient, type GitHubReviewPayload } from "./github-client.js";
import { parseDiff } from "./diff-parser.js";
import { reviewCode, type ReviewResult } from "./reviewer.js";
import type { CLIArgs } from "./cli.js";

// ---- printResult (moved from index.ts for dry-run use) ----
export function printResult(result: ReviewResult): void {
  const RISK_COLORS = { low: "\x1b[32m", medium: "\x1b[33m", high: "\x1b[31m" };
  const SEV_COLORS = { info: "\x1b[36m", warning: "\x1b[33m", error: "\x1b[31m" };
  const RESET = "\x1b[0m";

  const riskColor = RISK_COLORS[result.riskLevel];
  const approved = result.approved ? "\x1b[32m通過\x1b[0m" : "\x1b[31m需要修改\x1b[0m";

  console.log("\n" + "=".repeat(60));
  console.log(`審查結果：${approved}  風險等級：${riskColor}${result.riskLevel.toUpperCase()}${RESET}`);
  console.log("=".repeat(60));
  console.log(`\n摘要：${result.summary}\n`);

  if (result.comments.length === 0) {
    console.log("沒有發現問題。");
    return;
  }

  console.log(`發現 ${result.comments.length} 個問題：\n`);

  for (const c of result.comments) {
    const color = SEV_COLORS[c.severity];
    const loc = c.line ? `:${c.line}` : "";
    console.log(`${color}[${c.severity.toUpperCase()}]${RESET} ${c.filename}${loc}`);
    console.log(`  類別：${c.category}`);
    console.log(`  問題：${c.message}`);
    if (c.suggestion) console.log(`  建議：${c.suggestion}`);
    console.log();
  }
}

// ---- ReviewResult → GitHubReviewPayload mapping ----
export function mapToPayload(result: ReviewResult): GitHubReviewPayload {
  // Collect comments without a line number to append to body
  const noLineComments = result.comments.filter((c) => c.line == null);
  const lineComments = result.comments.filter((c) => c.line != null);

  let body = result.summary;
  if (noLineComments.length > 0) {
    const appended = noLineComments
      .map((c) => {
        const parts = [`**[${c.severity.toUpperCase()}]** ${c.filename}: ${c.message}`];
        if (c.suggestion) parts.push(`建議：${c.suggestion}`);
        return parts.join("\n");
      })
      .join("\n\n");
    body = `${body}\n\n---\n\n${appended}`;
  }

  const comments = lineComments.map((c) => {
    const commentBody = c.suggestion
      ? `${c.message}\n\n建議：${c.suggestion}`
      : c.message;
    return {
      path: c.filename,
      line: c.line!,
      body: commentBody,
    };
  });

  return {
    body,
    event: result.approved ? "APPROVE" : "REQUEST_CHANGES",
    comments,
  };
}

// ---- Main pipeline ----
export async function runPipeline(args: CLIArgs): Promise<void> {
  // Step 0: validate environment variables
  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubToken) {
    console.error("錯誤：缺少環境變數 GITHUB_TOKEN，請設定後再執行。");
    process.exit(1);
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    console.error("錯誤：缺少環境變數 ANTHROPIC_API_KEY，請設定後再執行。");
    process.exit(1);
  }

  const pr = { owner: args.owner, repo: args.repo, pullNumber: args.pullNumber };
  const client = createGitHubClient(githubToken);

  let currentStep = "fetch";
  try {
    // Step 1: fetch diff
    currentStep = "fetch";
    console.log(`[1/4] 正在從 GitHub 取得 PR #${pr.pullNumber} 的 diff...`);
    const rawDiff = await client.fetchPRDiff(pr);

    // Step 2: parse diff
    currentStep = "parse";
    console.log("[2/4] 解析 diff...");
    const files = parseDiff(rawDiff);
    if (files.length === 0) {
      console.warn("警告：diff 為空，將繼續送審。");
    } else {
      console.log(`  找到 ${files.length} 個修改的檔案：${files.map((f) => f.filename).join(", ")}`);
    }

    // Step 3: review
    currentStep = "review";
    console.log("[3/4] 呼叫 Claude 進行審查...");
    const result = await reviewCode(files, anthropicKey);

    // Step 4: publish or dry-run
    if (args.dryRun) {
      console.log("[4/4] --dry-run 模式，跳過發布，印出審查結果：");
      printResult(result);
    } else {
      currentStep = "publish";
      console.log("[4/4] 發布審查結果到 GitHub...");
      const payload = mapToPayload(result);
      const reviewUrl = await client.publishReview(pr, payload);
      console.log(`審查已發布：${reviewUrl}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`錯誤（步驟：${currentStep}）：${message}`);
    process.exit(1);
  }
}
