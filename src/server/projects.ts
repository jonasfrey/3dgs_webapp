import { config } from "./config.ts";
import { validId, validName } from "../shared/project.js";
export interface Artifact {
  id: string;
  type: string;
  name: string;
  path: string;
  size: number;
  mimeType: string;
  primary: boolean;
  downloadable: boolean;
  viewable: boolean;
}
export interface Project {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  status: string;
  input: { filename: string; path: string; size: number } | null;
  processing: {
    startedAt?: string;
    completedAt?: string;
    currentStage?: string;
    progress?: number;
    error?: string;
    message?: string;
  };
  outputs: Artifact[];
}
export const projects = new Map<string, Project>();
export function directory(id: string) {
  if (!validId(id)) throw new Error("Invalid project ID");
  return `${config.dataDirectory}/${id}`;
}
export function get(id: string) {
  const p = projects.get(id);
  if (!p) throw new Deno.errors.NotFound("Project not found");
  return p;
}
export async function save(p: Project) {
  p.updatedAt = new Date().toISOString();
  const temp = `${directory(p.id)}/project-${crypto.randomUUID()}.tmp`;
  await Deno.writeTextFile(temp, JSON.stringify(p, null, 2));
  await Deno.rename(temp, `${directory(p.id)}/project.json`);
}
export async function create(name: string) {
  const p: Project = {
    id: crypto.randomUUID(),
    name: validName(name),
    createdAt: new Date().toISOString(),
    updatedAt: "",
    status: "created",
    input: null,
    processing: {},
    outputs: [],
  };
  for (
    const dir of [
      "",
      "/input",
      "/frames",
      "/reconstruction",
      "/training",
      "/output",
      "/logs",
    ]
  ) await Deno.mkdir(directory(p.id) + dir, { recursive: true });
  await save(p);
  projects.set(p.id, p);
  return p;
}
export async function initialize() {
  await Deno.mkdir(config.dataDirectory, { recursive: true });
  for await (const entry of Deno.readDir(config.dataDirectory)) {
    if (!entry.isDirectory || !validId(entry.name)) continue;
    try {
      const p: Project = JSON.parse(
        await Deno.readTextFile(`${directory(entry.name)}/project.json`),
      );
      if (p.id !== entry.name) throw new Error("Mismatched project ID");
      if (["processing", "uploading"].includes(p.status)) {
        p.status = p.input ? "ready" : "created";
        p.processing.error = "Interrupted by server restart. You can retry.";
        await save(p);
      }
      projects.set(p.id, p);
    } catch (error) {
      console.error(`Could not load project ${entry.name}:`, error);
    }
  }
}
export async function safeFile(p: Project, path: string) {
  const base = await Deno.realPath(directory(p.id));
  const file = await Deno.realPath(`${base}/${path}`);
  if (!file.startsWith(base + "/")) throw new Error("Invalid file path");
  return file;
}
