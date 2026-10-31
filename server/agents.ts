import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { store } from "./store";
const exec = promisify(execFile);
const ELENA = "986c8b1b-7796-460f-996f-106d93d33e62";
export const crew = [
  {
    name: "Hannah",
    id: "bb1dd1bc-a142-4cea-854e-ec284f1f9a1e",
    question: "4+4",
    answer: "8",
    role: "Research",
  },
  {
    name: "Alex",
    id: "cmlzotnai000104jus8njgbef",
    question: "5+5",
    answer: "10",
    role: "Analysis",
  },
  {
    name: "Maya",
    id: "019f3b78-6f0c-73ec-a56c-1f5925ce457a",
    question: "6+6",
    answer: "12",
    role: "Creative",
  },
  {
    name: "Jamal",
    id: "019f3b78-6fec-711f-8e1c-6ffe5b22d83c",
    question: "7+7",
    answer: "14",
    role: "Outreach",
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
    orderId,
    marker,
    status: "starting",
    createdAt: Date.now(),
    children: [],
    budget: 3000,
    approvals: [],
  };
  store.put("agents", orderId, state);
  try {
    const description = `This is a PREPROD hackathon demonstration, not real outreach. The maker funded escrow order ${orderId}. Delegate exactly FOUR real Coworker Tasks using your delegation tool, then return their IDs. All tasks and your coordination are approved within 3,000 test credits TOTAL (maximum 500 per child). NO real outreach, internet prospecting, research, publishing, messages, repo changes, purchases, accounts or deployments. Only answer arithmetic. Include the exact marker ${marker} in EVERY CHILD TASK NAME AND DESCRIPTION so I can find their platform Task records. The four assignments are: ${crew.map((c) => `${c.name} (ID ${c.id}), name '${marker} ${c.name}', question '${c.question}', return only '${c.answer}'`).join("; ")}. Each is already approved; execute it immediately if possible. If a plan checkpoint is mandatory, state the tiny arithmetic plan. You must actually create the four child tasks; four answers or personas written by you do not count. Do not hire anyone beyond these four. No need to wait for asynchronous children; return their real IDs and initial statuses.`;
    const r = await cli([
      "tasks",
      "create",
      "--personal",
      "--coworker-id",
      ELENA,
      "--name",
      marker + " Elena",
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
    state.error = String((e as Error).message).slice(0, 500);
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
  try {
    const list = await cli([
      "tasks",
      "list",
      "--search",
      state.marker,
      "--limit",
      "20",
    ]);
    const tasks = (list.tasks ?? []).filter(
      (t: any) =>
        t.id === state.taskId || crew.some((c) => c.id === t.coworkerId),
    );
    const details: any[] = [];
    for (const t of tasks) {
      const r = await cli(["tasks", "get", t.id]);
      const task = r.task,
        events = r.events ?? task.events ?? [];
      const latest = events
        .filter((e: any) => e.coworkerId && e.comment)
        .at(-1);
      const completion = events
        .filter((e: any) => e.status === "COMPLETED" && e.comment)
        .at(-1);
      details.push({
        id: t.id,
        name: t.name,
        coworkerId: task.coworkerId,
        coworker: task.coworkerName,
        status: task.status,
        credits: task.totalCredits ?? 0,
        result: completion?.comment ?? null,
        latest: latest?.comment ?? null,
      });
      if (
        task.status === "INPUT_REQUIRED" &&
        latest &&
        !state.approvals.includes(latest.id)
      ) {
        const total = details.reduce((s, t) => s + t.credits, 0);
        if (total >= state.budget) throw Error("Agent budget exhausted");
        const text = String(latest.comment);
        if (
          /authenticat|sign.?in|password|api.?key|token\s+secret|credit.card|real.money/i.test(
            text,
          )
        )
          throw Error("Agent requests operator intervention");
        state.approvals.push(latest.id);
        store.put("agents", orderId, state);
        await cli([
          "tasks",
          "comment",
          t.id,
          "--comment",
          `Go. Approved to execute ONLY the four arithmetic tasks in the original brief. No outreach. Maximum 3,000 Preprod credits total, 500 per child. Keep ${state.marker} in each child Task name and description. Proceed and return actual child IDs or your assigned arithmetic answer.`,
        ]);
      }
    }
    state.children = crew.map((c) => ({
      ...c,
      ...details.find((t) => t.coworkerId === c.id),
      status: details.find((t) => t.coworkerId === c.id)?.status ?? "waiting",
    }));
    state.parent = details.find((t) => t.id === state.taskId);
    state.credits = details.reduce((s, t) => s + t.credits, 0);
    if (state.children.every((c: any) => c.status === "COMPLETED"))
      state.status = "completed";
    else if (
      details.some((t) => t.status === "FAILED" || t.status === "CANCELED")
    )
      state.status = "failed";
    state.updatedAt = Date.now();
    delete state.error;
  } catch (e) {
    state.error = (e as Error).message.slice(0, 500);
  }
  store.put("agents", orderId, state);
  return state;
}
