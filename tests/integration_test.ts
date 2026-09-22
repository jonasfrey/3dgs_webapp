import { run } from "../src/server/process.ts";
function assert(
  condition: unknown,
  message = "Assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}
Deno.test("process runner streams output, reports exit codes, and cancels", async () => {
  let output = "";
  await run({
    command: Deno.execPath(),
    args: ["eval", 'console.log("hello")'],
    onStdout: (text) => output += text,
  });
  assert(output.includes("hello"));
  let failed = false;
  try {
    await run({ command: Deno.execPath(), args: ["eval", "Deno.exit(7)"] });
  } catch (e) {
    failed = String(e).includes("code 7");
  }
  assert(failed, "Nonzero exit must fail");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 100);
  try {
    await run({
      command: Deno.execPath(),
      args: ["eval", "setInterval(() => {}, 1000)"],
      signal: controller.signal,
    });
    throw new Error("Cancellation should fail");
  } catch (e) {
    assert(e instanceof DOMException && e.name === "AbortError");
  } finally {
    clearTimeout(timer);
  }
});
Deno.test("project API streams validated uploads, protects files, persists, and deletes", async () => {
  const directory = await Deno.makeTempDir();
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();
  const base = `http://127.0.0.1:${port}`;
  let server: Deno.ChildProcess | undefined;
  async function start() {
    server = new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", "src/server/main.ts"],
      env: {
        DATA_DIRECTORY: directory,
        PORT: String(port),
        MAX_UPLOAD_BYTES: "1024",
      },
      stdout: "null",
      stderr: "null",
    }).spawn();
    for (let i = 0; i < 100; i++) {
      try {
        const r = await fetch(base + "/api/health");
        await r.arrayBuffer();
        if (r.ok) return;
      } catch { /* server starting */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("Server did not start");
  }
  async function stop() {
    server?.kill("SIGTERM");
    await server?.status;
    server = undefined;
  }
  async function call(path: string, method = "GET", body?: unknown) {
    const r = await fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, data: r.status === 204 ? null : await r.json() };
  }
  try {
    await start();
    assert((await call("/api/projects", "POST", { name: " " })).status === 400);
    const { data: p } = await call("/api/projects", "POST", {
      name: "Test capture",
    });
    assert(p.id && p.status === "created");
    const invalid = await fetch(base + `/api/projects/${p.id}/input`, {
      method: "POST",
      headers: {
        "Content-Type": "video/mp4",
        "X-Filename": "../../source.mp4",
      },
      body: "invalid",
    });
    assert(invalid.status === 400);
    await invalid.arrayBuffer();
    const video = new Uint8Array(32);
    video.set(new TextEncoder().encode("ftypisom"), 4);
    const upload = await fetch(base + `/api/projects/${p.id}/input`, {
      method: "POST",
      headers: {
        "Content-Type": "video/mp4",
        "X-Filename": "../../source.mp4",
      },
      body: video,
    });
    assert(upload.ok);
    assert((await upload.json()).input.path === "input/source.mp4");
    const partial = await fetch(base + `/api/projects/${p.id}/input`, {
      headers: { Range: "bytes=4-11" },
    });
    assert(partial.status === 206);
    assert(await partial.text() === "ftypisom");
    const badRange = await fetch(base + `/api/projects/${p.id}/input`, {
      headers: { Range: "bytes=99-" },
    });
    assert(badRange.status === 416);
    await badRange.arrayBuffer();
    const huge = await fetch(base + `/api/projects/${p.id}/input`, {
      method: "POST",
      headers: { "Content-Type": "video/mp4", "X-Filename": "large.mp4" },
      body: new Uint8Array(2048),
    });
    assert(huge.status === 413);
    await huge.arrayBuffer();
    assert((await call(`/api/projects/${p.id}/artifacts/fake`)).status === 404);
    const cross = await fetch(base + `/api/projects/${p.id}`, {
      method: "DELETE",
      headers: { Origin: "https://attacker.example" },
    });
    assert(cross.status === 403);
    await cross.arrayBuffer();
    await call(`/api/projects/${p.id}`, "PATCH", { name: "Renamed capture" });
    const events = await fetch(base + `/api/projects/${p.id}/events`);
    const reader = events.body!.getReader();
    const event = await reader.read();
    assert(new TextDecoder().decode(event.value).includes("Renamed capture"));
    await reader.cancel();
    await stop();
    await start();
    const restored = await call(`/api/projects/${p.id}`);
    assert(
      restored.data.name === "Renamed capture" &&
        restored.data.input.size === 32,
    );
    assert((await call(`/api/projects/${p.id}`, "DELETE")).status === 204);
    assert((await call(`/api/projects/${p.id}`)).status === 404);
    let removed = false;
    try {
      await Deno.stat(`${directory}/${p.id}`);
    } catch (e) {
      removed = e instanceof Deno.errors.NotFound;
    }
    assert(removed);
  } finally {
    await stop();
    await Deno.remove(directory, { recursive: true });
  }
});
