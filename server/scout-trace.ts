import {
  existsSync,
  readFileSync,
  openSync,
  fstatSync,
  readSync,
  closeSync,
} from "node:fs";
import { resolve } from "node:path";
export type ScoutSpec = {
  id: string;
  name: string;
  platform: string;
  role: string;
  question?: string;
  task?: string;
};
// Scout sessions belong to one deployed Coworker Task; they are not separate
// marketplace hires. Only its task-scoped audit events establish child status.
export function readScoutTrace(
  taskId: string,
  directory = process.env.OUTREACH_TRACE_DIR,
) {
  if (!directory || !/^[a-f0-9-]{36}$/i.test(taskId)) return undefined;
  const journal = resolve(directory, taskId + "-session.json");
  if (!existsSync(journal)) return undefined;
  const sessionId = JSON.parse(readFileSync(journal, "utf8")).sessionId;
  if (typeof sessionId !== "string" || !/^wrun_[a-z0-9]+$/i.test(sessionId))
    return undefined;
  const path = resolve(directory, "scout-events.jsonl");
  if (!existsSync(path)) return undefined;
  const fd = openSync(path, "r");
  let content: string;
  try {
    const size = fstatSync(fd).size,
      length = Math.min(size, 1024 * 1024),
      buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, size - length);
    content = buffer.toString("utf8");
  } finally {
    closeSync(fd);
  }
  const events = content.split("\n").flatMap((line) => {
    try {
      const e = JSON.parse(line);
      return e.parentSessionId === sessionId ? [e] : [];
    } catch {
      return [];
    }
  });
  const started = events.filter((e) => e.type === "scout.started");
  const batch = events.filter((e) => e.type === "scout.batch.completed").at(-1);
  return { sessionId, started, batch };
}
export function splitScoutReports(text: string) {
  const reports: Record<string, string> = {};
  const headings = [
    ...text.matchAll(
      /^\s{0,3}(?:#{1,6}\s*)?(?:\*\*)?Scout\s*(?:—|–|-|:)\s*(X|LinkedIn|Telegram|Instagram)(?:\*\*)?\s*:?[^\n]*$/gim,
    ),
  ];
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    reports[h[1].toLowerCase()] = text
      .slice(h.index! + h[0].length, headings[i + 1]?.index ?? text.length)
      .trim();
  }
  return reports;
}
export function scoutChildren(
  crew: ScoutSpec[],
  result: string,
  trace: ReturnType<typeof readScoutTrace>,
) {
  const reports = splitScoutReports(result);
  const children = crew.map((c) => {
    const start = trace?.started.find((s) => s.agent === c.id),
      done = trace?.batch?.scouts?.find((s: any) => s.agent === c.id);
    return {
      ...c,
      agentId: c.id,
      sessionId: start?.childSessionId ?? null,
      status: done
        ? done.status === "completed"
          ? "COMPLETED"
          : "FAILED"
        : start
          ? "RUNNING"
          : reports[c.platform.toLowerCase()]
            ? "REPORTED"
            : "waiting",
      result: reports[c.platform.toLowerCase()] ?? null,
    };
  });
  const verified =
    children.length === 4 &&
    children.every((c) => !!c.sessionId) &&
    new Set(children.map((c) => c.sessionId)).size === 4;
  return { children, verified };
}
