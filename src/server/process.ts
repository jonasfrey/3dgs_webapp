export interface ProcessOptions {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  signal?: AbortSignal;
  onStdout?: (text: string) => void;
  onStderr?: (text: string) => void;
}
export async function run(options: ProcessOptions) {
  options.signal?.throwIfAborted();
  options.onStdout?.(
    `$ ${JSON.stringify([options.command, ...options.args])}\n`,
  );
  const grouped = Deno.build.os === "linux";
  const child = new Deno.Command(grouped ? "setsid" : options.command, {
    args: grouped ? [options.command, ...options.args] : options.args,
    cwd: options.cwd,
    env: options.env,
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const abort = () => {
    try {
      if (grouped) Deno.kill(-child.pid, "SIGKILL");
      else child.kill("SIGKILL");
    } catch {
      try {
        child.kill("SIGKILL");
      } catch { /* already exited */ }
    }
  };
  options.signal?.addEventListener("abort", abort, { once: true });
  async function consume(
    stream: ReadableStream<Uint8Array>,
    callback?: (text: string) => void,
  ) {
    for await (const text of stream.pipeThrough(new TextDecoderStream())) {
      callback?.(text);
    }
  }
  try {
    const [status] = await Promise.all([
      child.status,
      consume(child.stdout, options.onStdout),
      consume(child.stderr, options.onStderr),
    ]);
    options.signal?.throwIfAborted();
    if (!status.success) {
      throw new Error(`${options.command} exited with code ${status.code}`);
    }
    return { code: status.code, success: status.success };
  } finally {
    options.signal?.removeEventListener("abort", abort);
  }
}
