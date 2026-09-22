# MP4 to 3D Gaussian Splat Web Application — Requirements

## 1. Product Goal

Build a self-contained web application for converting uploaded `.mp4` videos
into **3D Gaussian Splat (3DGS)** scenes.

The application manages conversion jobs as **projects**. Each project starts
with one MP4 video, runs a configurable processing pipeline, produces multiple
intermediate and final artifacts, and exposes the resulting Gaussian Splat
through an interactive browser-based 3D viewer.

The application must be installable and runnable with:

```bash
deno task start
```

This command must automatically install, download, or build dependencies and
external executables required by the application where practical.

## 2. Technology Requirements

- Use **Deno / DenoJS** for the server.
- Deno is unrestricted and may use `Deno.Command` to invoke required external
  executables.
- Client/server shared code must use **native ES6 modules**.
- Functions, types, validation, API contracts, constants, and utilities that can
  run in both environments should be shared rather than duplicated.
- Shared modules intended for the browser must not depend on Deno-only APIs.
- A bundler must not be required merely to share application code between server
  and browser.
- `deno task start` must be the primary application startup command.

## 3. Core User Workflow

```text
Create Project
     │
     ▼
Upload MP4
     │
     ▼
Project created
     │
     ▼
Start Processing
     │
     ├── Extract frames
     ├── Camera reconstruction / poses
     ├── Scene preprocessing
     ├── Gaussian Splat training
     └── Export artifacts
     │
     ▼
3D Gaussian Splat
     │
     ├── View interactively in browser
     └── Download output files
```

Processing may take a long time and must happen asynchronously from HTTP
requests. Closing or refreshing the browser must not stop an active conversion.

## 4. Projects

A project is the central domain object.

```ts
interface Project {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;

  status:
    | "created"
    | "uploading"
    | "ready"
    | "processing"
    | "completed"
    | "failed";

  input: {
    filename: string;
    path: string;
    size: number;
  } | null;

  processing: {
    startedAt?: string;
    completedAt?: string;
    currentStage?: string;
    progress?: number;
    error?: string;
  };

  outputs: ProjectArtifact[];
}
```

The application must support creating, listing, opening, renaming, processing,
cancelling, retrying/reprocessing, and deleting projects.

Projects must survive server restarts.

Deleting a project must also delete its uploaded video, generated files, logs,
and intermediate data.

## 5. Project Filesystem

Each project should have an isolated working directory.

```text
data/
  projects/
    <project-id>/
      project.json
      input/
        source.mp4
      frames/
        000001.jpg
        000002.jpg
        ...
      reconstruction/
        ...
      training/
        ...
      output/
        scene.ply
        scene.splat
        ...
      thumbnails/
        ...
      logs/
        processing.log
```

The exact intermediate structure may evolve with the processing backend. The web
application must not unnecessarily depend on the internal directory structure of
a particular 3DGS implementation.

## 6. Project Artifacts

Processing can generate multiple outputs. These must be represented explicitly.

```ts
interface ProjectArtifact {
  id: string;
  type:
    | "gaussian-splat"
    | "point-cloud"
    | "camera-data"
    | "video"
    | "image"
    | "log"
    | "other";

  name: string;
  path: string;
  size?: number;
  mimeType?: string;

  primary?: boolean;
  downloadable: boolean;
  viewable: boolean;
}
```

Exactly one artifact should normally be marked as the project's **primary
Gaussian Splat output**. The UI and API must not assume that it is the only
generated file.

## 7. Processing Pipeline

The conversion pipeline must be modular.

```ts
interface PipelineStage {
  id: string;
  name: string;
  run(context: PipelineContext): Promise<void>;
}
```

A first implementation may contain:

1. Validate video.
2. Inspect video metadata.
3. Extract frames.
4. Estimate camera poses.
5. Prepare reconstruction.
6. Train Gaussian Splat.
7. Convert/export viewer format.
8. Generate metadata/preview.
9. Register artifacts.
10. Mark project complete.

The exact executables used by these stages must be replaceable without
redesigning the application. The requirements deliberately do not mandate a
particular Gaussian Splat training implementation.

## 8. External Executables

Deno may invoke external processing tools through `Deno.Command`.

```ts
const command = new Deno.Command("ffmpeg", {
  args: ["-i", input],
  stdout: "piped",
  stderr: "piped",
});
```

Likely external dependencies include:

```text
MP4 decoding / frame extraction
        ↓
FFmpeg

Camera pose / sparse reconstruction
        ↓
COLMAP or equivalent

Gaussian Splat training
        ↓
Selected 3DGS implementation

Output conversion
        ↓
Viewer-specific conversion utilities
```

External tool implementations should remain replaceable.

## 9. Process Execution

The server needs a reusable process execution abstraction.

```ts
interface ProcessOptions {
  command: string;
  args: string[];
  cwd?: string;
  onStdout?: (text: string) => void;
  onStderr?: (text: string) => void;
}

interface ProcessResult {
  code: number;
  success: boolean;
}
```

It should support streaming stdout/stderr, cancellation, exit-code handling,
logging, working directories, environment variables, and progress extraction.

Every invocation should be logged into the project log.

Commands and paths derived from user-controlled data must never be passed
through a shell command string. Use argument arrays with `Deno.Command`.

## 10. Job Management

HTTP requests must not directly own long-running processing jobs.

```ts
interface ProjectJob {
  projectId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  stage?: string;
  progress?: number;
}
```

For v1, only one GPU-intensive Gaussian Splat training job should run
simultaneously unless explicitly configured otherwise. Additional jobs can be
queued.

The architecture should allow concurrency limits to be configured later and must
prevent conflicting simultaneous jobs for the same project.

## 11. Progress Reporting

The browser must receive processing status without requiring page refreshes.

Use **Server-Sent Events (SSE)** for v1 unless bidirectional real-time
communication later becomes necessary.

```text
GET /api/projects/:id/events
```

Example:

```json
{
  "type": "progress",
  "stage": "training",
  "progress": 0.42,
  "message": "Iteration 12600 / 30000"
}
```

The UI should show the current stage, overall progress where measurable,
stage-specific messages, elapsed processing time, and live/recent logs. Stages
without meaningful percentage progress may report an indeterminate state.

## 12. Browser Gaussian Splat Viewer

Completed projects must expose their primary Gaussian Splat directly in the
browser.

The viewer must support:

- Loading the project's primary Gaussian Splat.
- Orbit.
- Pan.
- Zoom.
- Reset camera.
- Fullscreen.
- Loading progress/state.
- Basic rendering statistics where available.

The viewer should load artifacts through an application endpoint such as:

```text
GET /api/projects/:id/artifacts/:artifactId
```

The viewer implementation should be isolated behind an abstraction:

```ts
interface SplatViewer {
  load(url: string): Promise<void>;
  dispose(): void;
}
```

This allows the rendering library or splat format to be changed later.

## 13. User Interface

The UI should remain intentionally simple.

### Project list

Show:

- Project name.
- Creation/update date.
- Current status.
- Processing progress where relevant.
- Whether a viewable result exists.
- A clear action to create a project.

### Project page

A project page should roughly contain:

```text
┌──────────────────────────────────────────────────────┐
│ My Project                              [Delete]      │
├──────────────────────────────────────────────────────┤
│                                                      │
│                Gaussian Splat Viewer                 │
│                                                      │
├──────────────────────────────────────────────────────┤
│ Status: Processing                                   │
│ Training Gaussian Splat                              │
│ ███████████████░░░░░░░░░  63%                       │
│                                                      │
│ [Cancel]                                             │
├──────────────────────────────────────────────────────┤
│ Input                                                │
│ source.mp4                           184 MB           │
│                                                      │
│ Outputs                                              │
│ scene.splat                         [View] [Download] │
│ scene.ply                                      [...] │
│ cameras.json                                  [...] │
├──────────────────────────────────────────────────────┤
│ Processing Log                                       │
│ > Extracted 438 frames...                            │
│ > Running reconstruction...                         │
└──────────────────────────────────────────────────────┘
```

Before processing, the viewer area may display the input video.

## 14. HTTP API

A minimal REST-style API should include:

```text
GET    /api/projects
POST   /api/projects

GET    /api/projects/:id
PATCH  /api/projects/:id
DELETE /api/projects/:id

POST   /api/projects/:id/input
GET    /api/projects/:id/input

POST   /api/projects/:id/process
POST   /api/projects/:id/cancel

GET    /api/projects/:id/events
GET    /api/projects/:id/log

GET    /api/projects/:id/artifacts
GET    /api/projects/:id/artifacts/:artifactId
```

Large MP4 uploads must be streamed directly to disk rather than loaded
completely into memory. The API must reject unsupported file types and enforce
configurable upload limits.

## 15. Deno Application Architecture

A possible structure:

```text
src/
  server/
    main.ts
    router.ts
    projects.ts
    jobs.ts
    pipeline.ts
    process.ts

  shared/
    project.ts
    artifacts.ts
    api.ts
    events.ts
    validation.ts

  client/
    main.ts
    api.ts
    project-list.ts
    project-view.ts
    splat-viewer.ts

static/
  index.html
  styles.css

data/
  projects/

deno.json
```

The important boundary is:

```text
server/
   │
   ├──────── shared/ ────────┐
   │                         │
   ▼                         ▼
Deno server              Browser
```

Code under `shared/` must be valid native ES modules and must not depend on
Deno-only APIs when loaded by the browser.

## 16. Shared Client/Server Modules

Types, validation logic, serialization, API contracts, constants, and suitable
utilities should be implemented once and imported by both server and browser.

```ts
// src/shared/project.ts

export type ProjectStatus =
  | "created"
  | "ready"
  | "processing"
  | "completed"
  | "failed";

export function canProcess(project: Project): boolean {
  return project.input !== null && project.status !== "processing";
}
```

The server can import this directly:

```ts
import { canProcess } from "../shared/project.ts";
```

The browser should receive/import the same ES module rather than a duplicated
implementation.

## 17. Startup and Installation

The following must be sufficient on a supported machine:

```bash
git clone <repository>
cd <repository>
deno task start
```

`deno task start` is responsible for:

- Checking required components.
- Installing/downloading/building dependencies where practical.
- Creating required application directories.
- Preparing processing dependencies.
- Starting the Deno HTTP server.
- Serving the browser application.

A clean installation should not require a collection of manual setup commands
first.

For large system/GPU dependencies that cannot safely or practically be installed
automatically, startup must detect missing requirements and return a precise,
actionable error rather than failing later during processing.

## 18. Configuration

Configuration should be centralized.

```ts
interface AppConfig {
  dataDirectory: string;
  port: number;
  maxUploadBytes: number;
  maxConcurrentJobs: number;
  ffmpegPath: string;
  colmapPath: string;
  gaussianSplatExecutable: string;
}
```

Defaults should allow:

```bash
deno task start
```

without additional configuration on a supported machine. Environment variables
may override defaults.

## 19. Failure Handling

Processing failures are expected and must be first-class application states.

A failed project should retain, where useful:

- Original input video.
- Intermediate results.
- stdout/stderr logs.
- Failed pipeline stage.
- Process exit code.
- Human-readable error information.

The UI must expose the failure and provide a **Retry processing** action.

One project's failure must never crash the Deno server or corrupt another
project.

Cancellation should terminate the active external process and leave the project
in a state from which processing can be restarted.

## 20. Persistence and Restart Behavior

Project metadata and artifacts must persist across application restarts.

After restart:

- Existing projects remain visible.
- Completed projects remain viewable.
- Existing artifacts remain downloadable.
- Interrupted projects must not remain incorrectly marked as actively processing
  forever.
- Interrupted jobs should transition to an appropriate recoverable state and be
  eligible for retry.

The v1 implementation may use filesystem-backed JSON metadata rather than
requiring a database.

## 21. Security Requirements

Even for an initially local application:

- Uploaded filenames must never determine filesystem paths directly.
- Project IDs must be generated by the server.
- Path traversal outside a project's directory must be impossible.
- External processes must receive arguments through `Deno.Command`, not shell
  interpolation.
- Artifact endpoints must expose only files registered to the requested project.
- Input and route parameters must be validated.
- Authentication may explicitly be declared **out of scope for v1** if the
  server is intended for trusted/local use.

## 22. Suggested v1 Scope

### In scope

- Create/delete/rename projects.
- Upload one MP4 per project.
- Persist project metadata.
- Inspect video with FFmpeg/ffprobe.
- Extract frames.
- Run camera reconstruction.
- Run one selected 3DGS implementation.
- Capture processing logs.
- Show processing state/progress.
- Persist generated artifacts.
- View resulting Gaussian Splat interactively.
- Download artifacts.
- Cancel/retry jobs.
- Survive browser refresh.
- Survive server restart without losing project state.
- Single-command startup through `deno task start`.

### Out of scope for v1

- Authentication/users.
- Cloud storage.
- Distributed workers.
- Multi-machine GPU scheduling.
- Collaboration/sharing.
- Editing Gaussian Splats.
- Advanced reconstruction controls.

## 23. Architectural Principle

The main application architecture should preserve the separation:

```text
Project
   ↓
Job
   ↓
Pipeline
   ↓
Artifacts
```

The UI, storage layer, API, and project model must not become tightly coupled to
the first COLMAP or 3D Gaussian Splat implementation selected.

This separation should make it possible to replace or add reconstruction,
training, export, and browser-viewer implementations later without redesigning
the project-management application.
