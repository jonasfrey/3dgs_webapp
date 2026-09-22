import { config, dependencies } from "./config.ts";
import {
  create,
  directory,
  get,
  initialize,
  type Project,
  projects,
  safeFile,
  save,
} from "./projects.ts";
import { busy, cancel, emit, enqueue, events } from "./jobs.ts";
import { canProcess, validId, validName } from "../shared/project.js";
const json = (value: unknown, status = 200) => Response.json(value, { status });
const mutations = new Set<string>();
async function exclusive(id: string, action: () => Promise<Response>) {
  if (mutations.has(id)) {
    return json({ error: "Project is busy. Try again shortly." }, 409);
  }
  mutations.add(id);
  try {
    return await action();
  } finally {
    mutations.delete(id);
  }
}
async function fileResponse(
  req: Request,
  path: string,
  type: string,
  download?: string,
) {
  const stat = await Deno.stat(path);
  const headers = new Headers({
    "Content-Type": type,
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
  });
  if (download) {
    headers.set(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(download)}`,
    );
  }
  let start = 0, end = stat.size - 1, status = 200;
  const range = req.headers.get("range");
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) {
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${stat.size}` },
      });
    }
    start = match[1]
      ? Number(match[1])
      : Math.max(0, stat.size - Number(match[2]));
    end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
    if (start > end || start >= stat.size) {
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${stat.size}` },
      });
    }
    status = 206;
    headers.set("Content-Range", `bytes ${start}-${end}/${stat.size}`);
  }
  headers.set("Content-Length", String(Math.max(0, end - start + 1)));
  const file = await Deno.open(path);
  await file.seek(start, Deno.SeekMode.Start);
  let remaining = end - start + 1;
  const stream = new ReadableStream({
    async pull(controller) {
      try {
        if (remaining <= 0) {
          file.close();
          controller.close();
          return;
        }
        const buffer = new Uint8Array(Math.min(65536, remaining));
        const count = await file.read(buffer);
        if (count === null) {
          file.close();
          controller.close();
          return;
        }
        remaining -= count;
        controller.enqueue(buffer.subarray(0, count));
      } catch (error) {
        try {
          file.close();
        } catch { /* closed */ }
        controller.error(error);
      }
    },
    cancel() {
      try {
        file.close();
      } catch { /* closed */ }
    },
  });
  return new Response(stream, { status, headers });
}
async function upload(req: Request, p: Project) {
  if (busy(p.id)) {
    return json(
      { error: "Cancel processing before replacing the video." },
      409,
    );
  }
  const filename = req.headers.get("x-filename") ?? "";
  if (
    !filename.toLowerCase().endsWith(".mp4") || !req.body ||
    req.headers.get("content-type")?.split(";")[0] !== "video/mp4"
  ) {
    return json({
      error: "Upload an MP4 video with Content-Type video/mp4 and X-Filename.",
    }, 400);
  }
  if (Number(req.headers.get("content-length")) > config.maxUploadBytes) {
    return json({ error: "Video exceeds the upload limit." }, 413);
  }
  const prior = p.status;
  p.status = "uploading";
  await save(p);
  emit(p);
  const path = `${directory(p.id)}/input/upload.tmp`;
  let size = 0;
  const signature = new Uint8Array(12);
  let prefixSize = 0;
  try {
    const file = await Deno.open(path, {
      create: true,
      write: true,
      truncate: true,
    });
    await req.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          size += chunk.length;
          if (size > config.maxUploadBytes) {
            throw new Error("Video exceeds the upload limit.");
          }
          const count = Math.min(12 - prefixSize, chunk.length);
          signature.set(chunk.subarray(0, count), prefixSize);
          prefixSize += count;
          controller.enqueue(chunk);
        },
      }),
    ).pipeTo(file.writable);
    if (
      prefixSize < 12 ||
      new TextDecoder().decode(signature.subarray(4, 8)) !== "ftyp"
    ) throw new Error("File is not an MP4 container.");
    await Deno.rename(path, `${directory(p.id)}/input/source.mp4`);
    p.input = {
      filename: filename.slice(0, 255),
      path: "input/source.mp4",
      size,
    };
    p.outputs = [];
    p.processing = {};
    p.status = "ready";
    await save(p);
    emit(p);
    return json(p);
  } catch (error) {
    await Deno.remove(path).catch(() => {});
    p.status = prior;
    await save(p);
    emit(p);
    return json(
      { error: String(error) },
      size > config.maxUploadBytes ? 413 : 400,
    );
  }
}
await initialize();
await Deno.mkdir("static/vendor", { recursive: true });
for (
  const [name, url] of [
    [
      "three.js",
      "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js",
    ],
    [
      "gaussian-splats.js",
      "https://cdn.jsdelivr.net/npm/@mkkellogg/gaussian-splats-3d@0.4.7/build/gaussian-splats-3d.module.js",
    ],
  ]
) {
  try {
    await Deno.stat(`static/vendor/${name}`);
  } catch {
    console.log(`Downloading viewer dependency: ${name}`);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Cannot download ${url}: ${response.status}`);
    }
    await Deno.writeFile(
      `static/vendor/${name}.tmp`,
      new Uint8Array(await response.arrayBuffer()),
    );
    await Deno.rename(`static/vendor/${name}.tmp`, `static/vendor/${name}`);
  }
}
const readiness = await dependencies();
for (const dependency of readiness.filter((d) => !d.available)) {
  console.warn(`Missing ${dependency.name}: ${dependency.help}`);
}
Deno.serve({ hostname: config.host, port: config.port }, async (req) => {
  try {
    const url = new URL(req.url), path = url.pathname;
    if (
      !["GET", "HEAD"].includes(req.method) && req.headers.get("origin") &&
      req.headers.get("origin") !== url.origin
    ) return json({ error: "Cross-origin request rejected" }, 403);
    if (path === "/api/health") {
      return json({
        ready: readiness.every((d) => d.available),
        dependencies: readiness,
        maxUploadBytes: config.maxUploadBytes,
      });
    }
    if (path === "/api/projects") {
      if (req.method === "GET") {
        return json(
          [...projects.values()].sort((a, b) =>
            b.createdAt.localeCompare(a.createdAt)
          ),
        );
      }
      if (req.method === "POST") {
        return json(await create((await req.json()).name), 201);
      }
    }
    const match =
      /^\/api\/projects\/([^/]+)(?:\/(input|process|cancel|events|log|artifacts)(?:\/([^/]+))?)?$/
        .exec(path);
    if (match) {
      const [, id, resource, artifactId] = match;
      if (!validId(id)) return json({ error: "Invalid project ID" }, 400);
      const p = get(id);
      if (req.method === "GET") {
        if (!resource) return json(p);
        if (resource === "input" && p.input) {
          return await fileResponse(
            req,
            await safeFile(p, p.input.path),
            "video/mp4",
          );
        }
        if (resource === "log") {
          try {
            const file = await Deno.open(
              `${directory(id)}/logs/processing.log`,
            );
            try {
              const stat = await file.stat();
              await file.seek(
                Math.max(0, stat.size - 100000),
                Deno.SeekMode.Start,
              );
              const buffer = new Uint8Array(Math.min(stat.size, 100000));
              const n = await file.read(buffer);
              return new Response(buffer.subarray(0, n ?? 0), {
                headers: { "Content-Type": "text/plain" },
              });
            } finally {
              file.close();
            }
          } catch (e) {
            if (!(e instanceof Deno.errors.NotFound)) throw e;
            return new Response("");
          }
        }
        if (resource === "artifacts") {
          if (!artifactId) return json(p.outputs);
          const artifact = p.outputs.find((a) => a.id === artifactId);
          if (!artifact) return json({ error: "Artifact not found" }, 404);
          return await fileResponse(
            req,
            await safeFile(p, artifact.path),
            artifact.mimeType,
            url.searchParams.has("download") ? artifact.name : undefined,
          );
        }
        if (resource === "events") {
          let cleanup = () => {};
          const body = new ReadableStream({
            start(controller) {
              const send = (value: unknown) =>
                controller.enqueue(
                  new TextEncoder().encode(
                    `data: ${JSON.stringify(value)}\n\n`,
                  ),
                );
              const handler = (e: Event) => send((e as CustomEvent).detail);
              events.addEventListener(id, handler);
              send({ type: "progress", project: p });
              const interval = setInterval(
                () =>
                  controller.enqueue(
                    new TextEncoder().encode(": keepalive\n\n"),
                  ),
                15000,
              );
              cleanup = () => {
                events.removeEventListener(id, handler);
                clearInterval(interval);
              };
            },
            cancel() {
              cleanup();
            },
          });
          return new Response(body, {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              "X-Accel-Buffering": "no",
            },
          });
        }
      }
      return await exclusive(id, async () => {
        if (!resource && req.method === "PATCH") {
          p.name = validName((await req.json()).name);
          await save(p);
          emit(p);
          return json(p);
        }
        if (!resource && req.method === "DELETE") {
          if (busy(id)) {
            return json({
              error: "Cancel the job and wait for it to stop before deleting.",
            }, 409);
          }
          await Deno.remove(directory(id), { recursive: true });
          projects.delete(id);
          return new Response(null, { status: 204 });
        }
        if (req.method === "POST" && resource === "input") {
          return await upload(req, p);
        }
        if (req.method === "POST" && resource === "process") {
          if (!canProcess(p) || busy(id)) {
            return json({
              error: "Upload a video and wait for any active job to finish.",
            }, 409);
          }
          if (readiness.some((d) => !d.available)) {
            return json({
              error:
                "Processing dependencies are missing. Open System setup for installation instructions.",
            }, 503);
          }
          await enqueue(p);
          return json(p, 202);
        }
        if (req.method === "POST" && resource === "cancel") {
          await cancel(p);
          return json(p);
        }
        return json({ error: "Method not allowed" }, 405);
      });
    }
    const staticPaths: Record<string, string> = {
      "/": "static/index.html",
      "/styles.css": "static/styles.css",
    };
    let file = staticPaths[path];
    if (
      /^\/(src\/(client|shared)|static\/vendor)\/[a-zA-Z0-9._-]+\.js$/.test(
        path,
      )
    ) file = path.slice(1);
    if (file && req.method === "GET") {
      return await fileResponse(
        req,
        file,
        file.endsWith(".html")
          ? "text/html"
          : file.endsWith(".css")
          ? "text/css"
          : "text/javascript",
      );
    }
    return json({ error: "Not found" }, 404);
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : String(error),
    }, error instanceof Deno.errors.NotFound ? 404 : 400);
  }
});
