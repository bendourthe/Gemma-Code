export interface ReportInput {
  title: string;
  author: string;
  date: string;
  rows: Array<{ label: string; value: number }>;
}

export function buildReport(input: ReportInput): string {
  // Header block (extract me)
  const lines: string[] = [];
  lines.push("=".repeat(60));
  lines.push(`Report: ${input.title}`);
  lines.push(`Author: ${input.author}`);
  lines.push(`Date:   ${input.date}`);
  lines.push("-".repeat(60));
  const label = `Rows (${input.rows.length})`;
  lines.push(label);
  lines.push("-".repeat(60));
  lines.push("");
  // --- end of header block ---

  for (const row of input.rows) {
    lines.push(`${row.label.padEnd(40)} ${row.value}`);
  }
  return lines.join("\n");
}
