function integer(name: string, fallback: number) {
  const value = Number(Deno.env.get(name) ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}
export const config = {
  dataDirectory: Deno.env.get("DATA_DIRECTORY") ??
    `${Deno.cwd()}/data/projects`,
  port: integer("PORT", 8000),
  host: Deno.env.get("HOST") ?? "127.0.0.1",
  maxUploadBytes: integer("MAX_UPLOAD_BYTES", 2 * 1024 ** 3),
  maxConcurrentJobs: integer("MAX_CONCURRENT_JOBS", 1),
  ffmpeg: Deno.env.get("FFMPEG_PATH") ?? "ffmpeg",
  ffprobe: Deno.env.get("FFPROBE_PATH") ?? "ffprobe",
  colmap: Deno.env.get("COLMAP_PATH") ?? "colmap",
  processData: Deno.env.get("NS_PROCESS_DATA_PATH") ?? "ns-process-data",
  train: Deno.env.get("NS_TRAIN_PATH") ?? "ns-train",
  exporter: Deno.env.get("NS_EXPORT_PATH") ?? "ns-export",
};
export async function dependencies() {
  const specs = [
    [
      "NVIDIA GPU",
      "nvidia-smi",
      "-L",
      "Install a compatible NVIDIA driver and expose an NVIDIA GPU to this process.",
    ],
    ...(Deno.build.os === "linux"
      ? [[
        "Process isolation",
        "setsid",
        "--version",
        "Install util-linux for process-group cancellation.",
      ]]
      : []),
    ["FFmpeg", config.ffmpeg, "-version", "Install FFmpeg, including ffprobe."],
    [
      "ffprobe",
      config.ffprobe,
      "-version",
      "Install FFmpeg, including ffprobe.",
    ],
    [
      "COLMAP",
      config.colmap,
      "-h",
      "Install COLMAP: https://colmap.github.io/install.html",
    ],
    [
      "Nerfstudio processing",
      config.processData,
      "--help",
      "Install Nerfstudio in the active Python environment: https://docs.nerf.studio/quickstart/installation.html",
    ],
    [
      "Splatfacto training",
      config.train,
      "--help",
      "Install Nerfstudio with compatible PyTorch/CUDA and an NVIDIA GPU.",
    ],
    [
      "Nerfstudio export",
      config.exporter,
      "--help",
      "Install Nerfstudio and expose ns-export on PATH.",
    ],
  ];
  return await Promise.all(specs.map(async ([name, command, arg, help]) => {
    try {
      const child = new Deno.Command(command, {
        args: [arg],
        stdout: "null",
        stderr: "null",
      }).spawn();
      const timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch { /* exited */ }
      }, 20000);
      const result = await child.status;
      clearTimeout(timer);
      return { name, command, available: result.success, help };
    } catch {
      return { name, command, available: false, help };
    }
  }));
}
