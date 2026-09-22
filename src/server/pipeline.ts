import { config } from "./config.ts";
import { directory, type Project } from "./projects.ts";
export interface PipelineContext {
  project: Project;
  signal: AbortSignal;
  execute: (command: string, args: string[]) => Promise<void>;
}
export interface PipelineStage {
  id: string;
  name: string;
  run(context: PipelineContext): Promise<void>;
}
async function findConfig(path: string): Promise<string | undefined> {
  for await (const entry of Deno.readDir(path)) {
    if (entry.isFile && entry.name === "config.yml") {
      return `${path}/${entry.name}`;
    }
    if (entry.isDirectory) {
      const found = await findConfig(`${path}/${entry.name}`);
      if (found) return found;
    }
  }
}
export const pipeline: PipelineStage[] = [
  {
    id: "inspect",
    name: "Inspect video",
    async run({ project, execute }) {
      await execute(config.ffprobe, [
        "-v",
        "error",
        "-show_format",
        "-show_streams",
        "-of",
        "json",
        `${directory(project.id)}/input/source.mp4`,
      ]);
    },
  },
  {
    id: "frames",
    name: "Extract frames",
    async run({ project, execute }) {
      await execute(config.ffmpeg, [
        "-y",
        "-i",
        `${directory(project.id)}/input/source.mp4`,
        "-vf",
        "fps=2,scale=1600:1600:force_original_aspect_ratio=decrease",
        "-frames:v",
        "500",
        `${directory(project.id)}/frames/%06d.jpg`,
      ]);
    },
  },
  {
    id: "reconstruction",
    name: "Reconstruct cameras",
    async run({ project, execute }) {
      await execute(config.processData, [
        "images",
        "--data",
        `${directory(project.id)}/frames`,
        "--output-dir",
        `${directory(project.id)}/reconstruction`,
        "--colmap-cmd",
        config.colmap,
      ]);
    },
  },
  {
    id: "training",
    name: "Train Gaussian splat",
    async run({ project, execute }) {
      await execute(config.train, [
        "splatfacto",
        "--data",
        `${directory(project.id)}/reconstruction`,
        "--output-dir",
        `${directory(project.id)}/training`,
        "--vis",
        "tensorboard",
        "--viewer.quit-on-train-completion",
        "True",
      ]);
    },
  },
  {
    id: "export",
    name: "Export scene",
    async run({ project, execute }) {
      const base = directory(project.id);
      const model = await findConfig(`${base}/training`);
      if (!model) throw new Error("Training did not produce a config.yml");
      await execute(config.exporter, [
        "gaussian-splat",
        "--load-config",
        model,
        "--output-dir",
        `${base}/output`,
      ]);
      const files = [
        ["output/splat.ply", "gaussian-splat", "application/octet-stream"],
        ["reconstruction/transforms.json", "camera-data", "application/json"],
        ["logs/processing.log", "log", "text/plain"],
      ];
      for (const [path, type, mimeType] of files) {
        const stat = await Deno.stat(`${base}/${path}`);
        project.outputs.push({
          id: crypto.randomUUID(),
          type,
          name: path.split("/").pop()!,
          path,
          size: stat.size,
          mimeType,
          primary: type === "gaussian-splat",
          downloadable: true,
          viewable: type === "gaussian-splat",
        });
      }
    },
  },
];
