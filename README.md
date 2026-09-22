# Depth Studio

A local Deno application for managing MP4-to-3D Gaussian Splat projects.

```sh
deno task start
```

Open http://127.0.0.1:8000. Startup downloads pinned browser rendering modules
to `static/vendor`, creates the data directory, and checks processing
dependencies. The dashboard, project management, and uploads work even when
conversion tools are missing. **System setup** lists the missing tools;
processing requests are rejected before a job starts until those tools are
available.

## Processing environment

The selected backend is
[Nerfstudio Splatfacto](https://docs.nerf.studio/nerfology/methods/splat.html).
Install [FFmpeg](https://ffmpeg.org/download.html),
[COLMAP](https://colmap.github.io/install.html), and
[Nerfstudio with compatible CUDA/PyTorch](https://docs.nerf.studio/quickstart/installation.html)
on a supported NVIDIA GPU machine. Start the app from the environment exposing
`ns-process-data`, `ns-train`, and `ns-export` on PATH. System GPU drivers and
CUDA are not installed automatically. Executable checks cannot guarantee
sufficient VRAM or a compatible GPU runtime; these failures are retained in
project logs.

The pipeline inspects video, extracts up to 500 frames at 2 fps (maximum
1600px), runs Nerfstudio's COLMAP reconstruction, trains Splatfacto, and exports
`splat.ply`. Camera data and logs are registered as additional artifacts. The
isolated viewer uses GaussianSplats3D 0.4.7 / Three.js 0.170.0 and supports
orbit, pan, zoom, reset, fullscreen, and the library's statistics overlay (press
**I**). Browser modules are cached locally after the first startup; no client
bundler is required.

## Configuration

| Environment variable                                      | Default                                |
| --------------------------------------------------------- | -------------------------------------- |
| `HOST`                                                    | `127.0.0.1`                            |
| `PORT`                                                    | `8000`                                 |
| `DATA_DIRECTORY`                                          | `<working directory>/data/projects`    |
| `MAX_UPLOAD_BYTES`                                        | `2147483648` (2 GiB)                   |
| `MAX_CONCURRENT_JOBS`                                     | `1`                                    |
| `FFMPEG_PATH`, `FFPROBE_PATH`, `COLMAP_PATH`              | respective executable names            |
| `NS_PROCESS_DATA_PATH`, `NS_TRAIN_PATH`, `NS_EXPORT_PATH` | respective Nerfstudio executable names |

Project JSON is persisted by atomic rename. Jobs continue independently of
browser connections. After server restart, interrupted jobs return to a
recoverable state. Reprocessing clears prior generated artifacts and
intermediates. Failed runs retain input, intermediates, errors, and logs until
retried or deleted. Progress indicates completed pipeline stages, not estimated
training iterations. Only one server instance may own a given data directory.

Authentication is outside v1 scope. Keep this application on a trusted local
machine. It binds to loopback by default, rejects cross-origin mutations,
streams uploads, uses generated storage paths, validates MP4 container
signatures, and exposes only registered artifacts within a project's real
directory. Uploads use raw `video/mp4` bodies with an `X-Filename` header. HTTP
byte ranges support video seeking.

## Development

```sh
deno task check
deno task test
```

`src/shared` contains native JavaScript ES modules consumed by server and
browser. Server modules separate configuration, persistence, process execution,
jobs, and pipeline stages. Replace `src/server/pipeline.ts` to integrate a
different backend.

Tests cover process output/exit/cancellation, API validation, uploads, limits,
range requests, SSE, persistence, file isolation, and deletion. Full
reconstruction and GPU training need validation on a configured GPU host with a
suitable real capture; they have not been exercised in this environment.
# 3dgs_webapp
