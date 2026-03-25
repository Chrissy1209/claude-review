import Anthropic from "@anthropic-ai/sdk";
import type { FileDiff } from "./diff-parser.js";

export type RiskLevel = "low" | "medium" | "high";

export interface ReviewComment {
  filename: string;
  line?: number;
  severity: "info" | "warning" | "error";
  category: "security" | "logic" | "quality" | "style";
  message: string;
  suggestion?: string;
}

export interface ReviewResult {
  riskLevel: RiskLevel;
  summary: string;
  comments: ReviewComment[];
  approved: boolean;
}

// The system prompt defines what kind of reviewer we want
const SYSTEM_PROMPT = `你是一個資深的程式碼審查員，專精於找出安全漏洞、邏輯錯誤與可維護性問題。

審查時請關注：
1. **安全性**：SQL injection、XSS、hardcoded secrets、不安全的反序列化
2. **邏輯錯誤**：off-by-one、null/undefined 未處理、競態條件
3. **品質**：函式過長、重複邏輯、不必要的複雜度
4. **風格**：命名不清楚、缺少型別標注

回覆格式必須是嚴格的 JSON，不要有任何其他文字：
{
  "riskLevel": "low" | "medium" | "high",
  "summary": "一段話總結這個 PR 的整體狀況",
  "approved": true | false,
  "comments": [
    {
      "filename": "檔案名稱",
      "line": 行號（可選）,
      "severity": "info" | "warning" | "error",
      "category": "security" | "logic" | "quality" | "style",
      "message": "問題描述",
      "suggestion": "建議修改方式（可選）"
    }
  ]
}`;

export async function reviewCode(
  files: FileDiff[],
  apiKey: string
): Promise<ReviewResult> {
  const client = new Anthropic({ apiKey });

  // Build the user message — give the LLM the diff content to review
  const diffContent = files
    .map((f) => {
      return [
        `### 檔案：${f.filename} (${f.language})`,
        `新增 ${f.additions} 行 / 刪除 ${f.deletions} 行`,
        "```diff",
        f.hunks.join("\n"),
        "```",
      ].join("\n");
    })
    .join("\n\n");

  const userMessage = `請審查以下 PR 的程式碼變更：\n\n${diffContent}`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2048,
    messages: [{ role: "user", content: userMessage }],
    system: SYSTEM_PROMPT,
  });

  // Extract the text response and parse JSON
  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  // Strip markdown code fences if present
  const cleaned = text.replace(/```json\n?|\n?```/g, "").trim();

  try {
    return JSON.parse(cleaned) as ReviewResult;
  } catch {
    // Fallback if JSON parsing fails
    return {
      riskLevel: "medium",
      summary: "無法解析審查結果，請檢查 API 回應。",
      approved: false,
      comments: [],
    };
  }
}
