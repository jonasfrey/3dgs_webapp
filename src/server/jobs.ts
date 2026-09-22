import { config } from "./config.ts";
import { directory, get, type Project, save } from "./projects.ts";
import { pipeline } from "./pipeline.ts";
import { run } from "./process.ts";
export const events = new EventTarget();
const queue: string[] = [];
const active = new Map<string, AbortController>();
export const busy = (id: string) => active.has(id) || queue.includes(id);
export function emit(p: Project, text?: string) {
  events.dispatchEvent(
    new CustomEvent(p.id, {
      detail: { type: text ? "log" : "progress", project: p, text },
    }),
  );
}
export async function enqueue(p: Project) {
  if (busy(p.id)) throw new Error("Project already queued or running");
  p.status = "processing";
  p.processing = { currentStage: "queued", message: "Waiting for a worker" };
  queue.push(p.id);
  await save(p);
  emit(p);
  pump();
}
export async function cancel(p: Project) {
  if (!busy(p.id)) return;
  if (active.has(p.id)) {
    active.get(p.id)!.abort();
    return;
  }
  const index = queue.indexOf(p.id);
  if (index >= 0) queue.splice(index, 1);
  p.status = p.input ? "ready" : "created";
  p.processing = { message: "Cancelled. Ready to retry." };
  await save(p);
  emit(p);
}
function pump() {
  while (active.size < config.maxConcurrentJobs && queue.length) {
    const p = get(queue.shift()!);
    const controller = new AbortController();
    active.set(p.id, controller);
    execute(p, controller.signal).catch(console.error).finally(() => {
      active.delete(p.id);
      pump();
    });
  }
}
async function execute(p: Project, signal: AbortSignal) {
  let logChain = Promise.resolve();
  const log = (text: string) => {
    emit(p, text);
    logChain = logChain.then(() =>
      Deno.writeTextFile(`${directory(p.id)}/logs/processing.log`, text, {
        append: true,
      })
    );
  };
  try {
    p.outputs = [];
    p.processing.startedAt = new Date().toISOString();
    for (const folder of ["frames", "reconstruction", "training", "output"]) {
      await Deno.remove(`${directory(p.id)}/${folder}`, { recursive: true });
      await Deno.mkdir(`${directory(p.id)}/${folder}`);
    }
    await Deno.writeTextFile(`${directory(p.id)}/logs/processing.log`, "");
    for (const [index, stage] of pipeline.entries()) {
      signal.throwIfAborted();
      p.processing.currentStage = stage.id;
      p.processing.progress = index / pipeline.length;
      p.processing.message = stage.name;
      await save(p);
      emit(p);
      log(`\n── ${stage.name} ──\n`);
      await stage.run({
        project: p,
        signal,
        execute: async (command, args) => {
          await run({ command, args, signal, onStdout: log, onStderr: log });
        },
      });
    }
    await logChain;
    p.status = "completed";
    p.processing.progress = 1;
    p.processing.message = "Your scene is ready";
  } catch (error) {
    p.status = signal.aborted ? "ready" : "failed";
    p.processing.error = signal.aborted ? undefined : String(error);
    p.processing.message = signal.aborted
      ? "Cancelled. Ready to retry."
      : "Processing failed";
    log(`\n${p.processing.error ?? p.processing.message}\n`);
    await logChain.catch(console.error);
  } finally {
    p.processing.completedAt = new Date().toISOString();
    await save(p);
    emit(p);
  }
}
