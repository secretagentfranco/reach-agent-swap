import "dotenv/config";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { store } from "./store";
import { readScoutTrace, scoutChildren, type ScoutSpec } from "./scout-trace";
const exec = promisify(execFile);
export const coordinator = {
  name: "Outreach",
  id:
    process.env.OUTREACH_COWORKER_ID ?? "01a191fd-9561-7777-8886-ec6f6dc9f7cd",
};
export const crew: ScoutSpec[] = [
  {
    id: "scout-x",
    name: "Scout",
    platform: "X",
    role: "X",
    task: "Buyer discovery",
  },
  {
    id: "scout-linkedin",
    name: "Scout",
    platform: "LinkedIn",
    role: "LinkedIn",
    task: "Business matching",
  },
  {
    id: "scout-telegram",
    name: "Scout",
    platform: "Telegram",
    role: "Telegram",
    task: "Community matching",
  },
  {
    id: "scout-instagram",
    name: "Scout",
    platform: "Instagram",
    role: "Instagram",
    task: "Audience matching",
  },
];
let queue = Promise.resolve();
export function cli(args: string[]): Promise<any> {
  const op = queue.then(async () => {
    const r = await exec("./sokosumi", [...args, "--json"], {
      timeout: 45000,
      maxBuffer: 2 ** 22,
    });
    return JSON.parse(r.stdout);
  });
  queue = op.then(
    () => {},
    () => {},
  );
  return op;
}
export async function startAgents(orderId: string) {
  let state = store.get("agents", orderId);
  if (state) return state;
  const marker = "SWAP-" + orderId.slice(0, 12);
  state = {
    version: 2,
    orderId,
    marker,
    status: "starting",
    createdAt: Date.now(),
    coordinator,
    team: crew,
    mode: "simulation",
    children: crew.map((c) => ({ ...c, status: "waiting" })),
    approvals: [],
  };
  store.put("agents", orderId, state);
  try {
    const order = store.get("orders", orderId);
    if (!order) throw Error("A funded order is required");
    const intent = order.side === "sell" ? "buyers" : "sellers";
    const description = `Find potential ${intent} for this fixed-rate token order. The maker wants to ${order.side} ${order.amount} ${order.token.symbol} for ${order.total} ${order.quote.symbol} on Cardano Preprod. Token asset unit: ${order.token.unit}. Quote asset unit: ${order.quote.unit}. Order ID: ${orderId}. Coordinate your four platform-specialist Scouts for X, LinkedIn, Telegram and Instagram. Return one candidate per platform, their buying or selling intent, why the candidate matches these terms, and a platform-specific outreach approach or next step. Organize the result under Scout — X, Scout — LinkedIn, Scout — Telegram and Scout — Instagram.`;
    const r = await cli([
      "tasks",
      "create",
      "--personal",
      "--coworker-id",
      coordinator.id,
      "--name",
      marker + " Outreach",
      "--description",
      description,
      "--status",
      "READY",
    ]);
    state.taskId = r.task?.id;
    if (!state.taskId)
      throw Error(
        "Task creation outcome unknown: inspect account before retrying",
      );
    state.status = "running";
  } catch (e) {
    state.status = "uncertain";
    state.error = (e as Error).message.slice(0, 500);
  }
  store.put("agents", orderId, state);
  return state;
}
export async function pollAgents(orderId: string) {
  const state = store.get("agents", orderId);
  if (
    !state?.taskId ||
    ["completed", "failed", "uncertain"].includes(state.status)
  )
    return state;
  // Do not reinterpret old Elena/Coworker histories as Scout sessions.
  if (state.version !== 2) return state;
  try {
    const r = await cli(["tasks", "get", state.taskId]);
    const task = r.task;
    if (task.coworkerId !== state.coordinator.id)
      throw Error("Coordinator identity mismatch");
    const events = r.events ?? task.events ?? [];
    const completion = events
      .filter((e: any) => e.status === "COMPLETED" && e.comment)
      .at(-1);
    const latest = events.filter((e: any) => e.coworkerId && e.comment).at(-1);
    state.parent = {
      id: task.id,
      coworker: task.coworkerName,
      status: task.status,
      result: completion?.comment ?? null,
    };
    state.result = completion?.comment ?? null;
    state.credits = task.totalCredits ?? null;
    delete state.traceWarning;
    let trace;
    try {
      trace = readScoutTrace(state.taskId);
    } catch {
      state.traceWarning = "The deployed worker trace could not be read.";
    }
    const observed = scoutChildren(state.team, state.result ?? "", trace);
    state.children = observed.children;
    state.traceVerified = observed.verified;
    state.sessionId = trace?.sessionId ?? null;
    state.messagesSent = trace?.batch?.messagesSent ?? null;
    if (task.status === "COMPLETED") {
      if (state.children.some((c: any) => c.status === "FAILED"))
        state.status = "failed";
      else state.status = "completed";
    } else if (["FAILED", "CANCELED"].includes(task.status))
      state.status = "failed";
    if (task.status === "INPUT_REQUIRED")
      state.error =
        "Outreach requests operator input; no additional actions were approved.";
    state.updatedAt = Date.now();
    if (task.status !== "INPUT_REQUIRED") delete state.error;
  } catch (e) {
    state.error = (e as Error).message.slice(0, 500);
  }
  store.put("agents", orderId, state);
  return state;
}
