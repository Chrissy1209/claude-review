export interface FileDiff {
  filename: string;
  language: string;
  additions: number;
  deletions: number;
  hunks: string[];
  fullDiff: string;
}

const LANGUAGE_MAP: Record<string, string> = {
  ts: "TypeScript", tsx: "TypeScript",
  js: "JavaScript", jsx: "JavaScript",
  py: "Python", go: "Go",
  rs: "Rust", java: "Java",
  cs: "C#", cpp: "C++",
  rb: "Ruby", php: "PHP",
};

export function parseDiff(rawDiff: string): FileDiff[] {
  const files: FileDiff[] = [];
  // Split by "diff --git" to get per-file diffs
  const sections = rawDiff.split(/^diff --git /m).filter(Boolean);

  for (const section of sections) {
    const lines = section.split("\n");
    // Extract filename from "a/path/to/file b/path/to/file"
    const fileMatch = lines[0].match(/b\/(.+)$/);
    if (!fileMatch) continue;

    const filename = fileMatch[1];
    const ext = filename.split(".").pop() ?? "";
    const language = LANGUAGE_MAP[ext] ?? ext.toUpperCase();

    let additions = 0;
    let deletions = 0;
    const hunks: string[] = [];
    let currentHunk: string[] = [];

    for (const line of lines) {
      if (line.startsWith("@@")) {
        if (currentHunk.length) hunks.push(currentHunk.join("\n"));
        currentHunk = [line];
      } else if (line.startsWith("+") && !line.startsWith("+++")) {
        additions++;
        currentHunk.push(line);
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        deletions++;
        currentHunk.push(line);
      } else {
        currentHunk.push(line);
      }
    }
    if (currentHunk.length) hunks.push(currentHunk.join("\n"));

    files.push({ filename, language, additions, deletions, hunks, fullDiff: section });
  }

  return files;
}
