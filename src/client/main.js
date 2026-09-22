import { bytes, canProcess, stages } from "../shared/project.js";
import { SplatViewer } from "./viewer.js";
const $ = (s) => document.querySelector(s);
const escape = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]),
  );
let projects = [],
  current,
  source,
  viewer,
  filter = "all",
  search = "",
  routeVersion = 0;
const app = $("#app");
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("show");
  setTimeout(() => $("#toast").classList.remove("show"), 5000);
}
async function api(path, options) {
  const response = await fetch("/api" + path, options);
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error);
  }
  return response.status === 204 ? null : response.json();
}
const post = (path, data) =>
  api(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data ?? {}),
  });
function badge(p) {
  return `<span class="badge ${escape(p.status)}"><i></i>${
    escape(
      p.status === "processing" && p.processing.currentStage === "queued"
        ? "queued"
        : p.status,
    )
  }</span>`;
}
function newProject() {
  $("#create-dialog").showModal();
}
$("#dismiss").onclick = () => $("#create-dialog").close();
$("#create-form").onsubmit = async (event) => {
  event.preventDefault();
  try {
    const p = await post("/projects", {
      name: new FormData(event.target).get("name"),
    });
    $("#create-dialog").close();
    event.target.reset();
    location.hash = p.id;
  } catch (e) {
    toast(e.message);
  }
};
$("#setup").onclick = () => $("#setup-dialog").showModal();
$("#close-setup").onclick = () => $("#setup-dialog").close();
function renderList() {
  $("#breadcrumb").textContent = "All projects";
  app.innerHTML =
    `<div class="page-heading"><div><div class="eyebrow">YOUR SPACES, RECONSTRUCTED</div><h1>All projects<span class="title-count">${projects.length}</span></h1><p>Turn a moment in motion into a space you can explore.</p></div><button class="primary" id="new-project">＋ New project</button></div>
  <section class="intro"><div class="intro-copy"><span class="eyebrow">FROM CAPTURE TO CREATION</span><h2>A different dimension<br>to your videos.</h2><p>Upload a video. Reconstruct the scene.<br>Explore every angle in 3D.</p><button class="text-button" id="intro-create">Create your first scene <span>↗</span></button></div><div class="scene-art" aria-hidden="true"><div class="orb orb-one"></div><div class="orb orb-two"></div><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="art-label">2D CAPTURE <span>──────────</span> 3D SPACE</div></div></section>
  <div class="list-toolbar"><div class="tabs"><button data-filter="all" class="${
      filter === "all" ? "selected" : ""
    }">All projects</button><button data-filter="completed" class="${
      filter === "completed" ? "selected" : ""
    }">Completed</button><button data-filter="processing" class="${
      filter === "processing" ? "selected" : ""
    }">Processing</button></div><input id="search" aria-label="Search projects" placeholder="⌕  Search projects" value="${
      escape(search)
    }"></div><div id="project-grid" class="project-grid"></div>
  <div class="workflow"><div><span>01</span><h3>Capture</h3><p>Move slowly around your subject.<br>Keep it in frame from every angle.</p></div><div><span>02</span><h3>Reconstruct</h3><p>We find camera positions and train<br>a Gaussian splat of your scene.</p></div><div><span>03</span><h3>Explore</h3><p>Orbit, zoom, and revisit your space.<br>Download it to make it your own.</p></div></div>`;
  $("#new-project").onclick = newProject;
  $("#intro-create").onclick = newProject;
  document.querySelectorAll("[data-filter]").forEach((el) =>
    el.onclick = () => {
      filter = el.dataset.filter;
      renderList();
    }
  );
  $("#search").oninput = (event) => {
    search = event.target.value;
    renderCards();
  };
  renderCards();
}
function renderCards() {
  const filtered = projects.filter((p) =>
    (filter === "all" || p.status === filter) &&
    p.name.toLowerCase().includes(search.toLowerCase())
  );
  $("#project-grid").innerHTML =
    filtered.map((p) =>
      `<a class="project-card" href="#${p.id}"><div class="card-visual"><span class="card-icon">${
        p.status === "completed" ? "◈" : "▷"
      }</span>${badge(p)}<span class="file-label">${
        p.input ? "MP4 · " + bytes(p.input.size) : "AWAITING VIDEO"
      }</span></div><div class="card-details"><h3>${
        escape(p.name)
      } <span>↗</span></h3><p>${
        new Date(p.updatedAt).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      }${
        p.outputs.some((a) => a.primary) ? " · 3D scene available" : ""
      }</p></div></a>`
    ).join("") + (filter === "all" && !search
      ? `<button class="create-card" id="grid-create"><span>＋</span><h3>Create a new project</h3><p>Start with an MP4 video</p><small>LOCAL UPLOAD · UP TO ${
        health ? bytes(health.maxUploadBytes) : "2 GB"
      }</small></button>`
      : "");
  if (!filtered.length && (filter !== "all" || search)) {
    $("#project-grid").innerHTML =
      '<p class="muted">No projects match this view.</p>';
  }
  if ($("#grid-create")) $("#grid-create").onclick = newProject;
}
function renderProject(p) {
  current = p;
  $("#breadcrumb").textContent = p.name;
  app.innerHTML =
    `<a class="back" href="#">← All projects</a><div class="page-heading"><div><div class="eyebrow">PROJECT WORKSPACE</div><h1 id="project-name">${
      escape(p.name)
    }</h1><p>Created ${
      new Date(p.createdAt).toLocaleDateString()
    }</p></div><div class="actions"><button class="secondary" id="rename">Rename</button><button class="secondary danger" id="delete">Delete</button></div></div>
  <section class="viewer-section"><div id="viewer"><div class="upload-prompt"><span class="upload-symbol">↥</span><h2>Every space starts with a capture.</h2><p>Drop an MP4 here or choose a video to get started.</p><button class="primary" id="choose-video">Choose video</button><small>MP4 · Up to ${
      bytes(health.maxUploadBytes)
    }</small></div></div><div class="viewer-bar"><span id="viewer-label">SCENE PREVIEW</span><div><button id="reset-camera" class="text-button">Reset camera</button><button id="fullscreen" class="text-button">⛶ Fullscreen</button></div></div></section>
  <div class="detail-columns"><section class="panel"><div class="panel-heading"><h3>Processing</h3><span id="status"></span></div><p id="message"></p><progress id="progress" max="1"></progress><div class="stage-list">${
      stages.map(([id, name], index) =>
        `<div data-stage="${id}"><span>${
          String(index + 1).padStart(2, "0")
        }</span>${name}</div>`
      ).join("")
    }</div><p class="error" id="processing-error"></p><div class="actions"><button id="process" class="primary">Start processing ↗</button><button id="cancel" class="secondary">Cancel</button></div><p id="elapsed" class="muted"></p></section>
  <section class="panel"><h3>Project files</h3><div id="input-file"></div><input type="file" id="video-file" accept="video/mp4,.mp4" hidden><button class="text-button" id="replace-video">Upload video ↑</button><div id="upload-status" class="muted"></div><h4>OUTPUTS</h4><div id="outputs"></div></section></div>
  <section class="panel logs"><div class="panel-heading"><h3>Processing log</h3><a href="/api/projects/${p.id}/log" target="_blank">Open log ↗</a></div><pre id="logs">No processing logs yet.</pre></section>`;
  $("#choose-video")?.addEventListener("click", () => $("#video-file").click());
  $("#replace-video").onclick = () => $("#video-file").click();
  $("#video-file").onchange = (e) => {
    if (e.target.files[0]) upload(e.target.files[0]);
  };
  $("#viewer").ondragover = (e) => e.preventDefault();
  $("#viewer").ondrop = (e) => {
    e.preventDefault();
    if (e.dataTransfer.files[0]) upload(e.dataTransfer.files[0]);
  };
  $("#rename").onclick = async () => {
    const name = prompt("Project name", current.name);
    if (name === null) return;
    try {
      const updated = await api("/projects/" + p.id, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      current = updated;
      $("#project-name").textContent = updated.name;
      $("#breadcrumb").textContent = updated.name;
    } catch (e) {
      toast(e.message);
    }
  };
  $("#delete").onclick = async () => {
    if (!confirm(`Delete “${current.name}” and all its files?`)) return;
    try {
      await api("/projects/" + p.id, { method: "DELETE" });
      location.hash = "";
    } catch (e) {
      toast(e.message);
    }
  };
  $("#process").onclick = async () => {
    try {
      update(await post(`/projects/${p.id}/process`));
    } catch (e) {
      toast(e.message);
      if (!health.ready) $("#setup-dialog").showModal();
    }
  };
  $("#cancel").onclick = async () => {
    try {
      await post(`/projects/${p.id}/cancel`);
    } catch (e) {
      toast(e.message);
    }
  };
  $("#fullscreen").onclick = () =>
    $("#viewer").requestFullscreen().catch((e) => toast(e.message));
  $("#reset-camera").onclick = () => viewer?.reset();
  update(p);
  loadPreview(p);
  fetch(`/api/projects/${p.id}/log`).then((r) => r.text()).then((text) => {
    if (current?.id === p.id) {
      $("#logs").textContent = text || "No processing logs yet.";
    }
  });
  source = new EventSource(`/api/projects/${p.id}/events`);
  source.onmessage = (event) => {
    const value = JSON.parse(event.data);
    if (value.type === "log") {
      $("#logs").textContent = ($("#logs").textContent + value.text).slice(
        -100000,
      );
      $("#logs").scrollTop = $("#logs").scrollHeight;
    } else {
      const changed = current?.outputs.find((a) =>
        a.primary
      )?.id !== value.project.outputs.find((a) => a.primary)?.id;
      update(value.project);
      if (changed) loadPreview(value.project);
    }
  };
}
function update(p) {
  current = p;
  $("#status").innerHTML = badge(p);
  $("#message").textContent = p.processing.message ||
    (p.input
      ? "Your video is ready to reconstruct."
      : "Upload a video to begin.");
  $("#progress").value = p.processing.progress || 0;
  $("#processing-error").textContent = p.processing.error || "";
  $("#process").disabled = !canProcess(p);
  $("#process").textContent = p.status === "failed"
    ? "Retry processing ↗"
    : p.status === "completed"
    ? "Reprocess ↗"
    : "Start processing ↗";
  $("#cancel").hidden = p.status !== "processing";
  $("#delete").disabled = ["processing", "uploading"].includes(p.status);
  $("#replace-video").disabled = ["processing", "uploading"].includes(p.status);
  document.querySelectorAll("[data-stage]").forEach((el) => {
    el.classList.toggle(
      "current",
      el.dataset.stage === p.processing.currentStage,
    );
  });
  $("#input-file").innerHTML = p.input
    ? `<div class="file-row"><span class="file-icon">▷</span><div><strong>${
      escape(p.input.filename)
    }</strong><small>${bytes(p.input.size)} · MP4 video</small></div></div>`
    : '<p class="muted">No video uploaded yet.</p>';
  $("#outputs").innerHTML = p.outputs.length
    ? p.outputs.map((a) =>
      `<div class="output-row"><span>${escape(a.name)}<small>${
        bytes(a.size)
      }</small></span><a href="/api/projects/${p.id}/artifacts/${a.id}?download">Download ↓</a></div>`
    ).join("")
    : '<p class="muted">Your scene and camera data will appear here after processing.</p>';
}
async function loadPreview(p) {
  viewer?.dispose();
  viewer = null;
  const primary = p.outputs.find((a) => a.primary && a.viewable);
  if (primary) {
    $("#viewer").innerHTML = "";
    $("#viewer-label").textContent =
      "3D SCENE · Drag to orbit · Right-drag to pan · Scroll to zoom · I for stats";
    const next = new SplatViewer($("#viewer"));
    viewer = next;
    try {
      await next.load(`/api/projects/${p.id}/artifacts/${primary.id}`);
    } catch (e) {
      if (viewer === next) toast("Could not load the scene: " + e.message);
    }
  } else if (p.input) {
    $("#viewer").innerHTML =
      `<video controls src="/api/projects/${p.id}/input"></video>`;
    $("#viewer-label").textContent = "INPUT VIDEO · PREVIEW";
  }
}
function upload(file) {
  if (!file.name.toLowerCase().endsWith(".mp4")) {
    return toast("Choose an MP4 video.");
  }
  if (file.size > health.maxUploadBytes) {
    return toast("Video exceeds the upload limit.");
  }
  const id = current.id, xhr = new XMLHttpRequest();
  xhr.open("POST", `/api/projects/${id}/input`);
  xhr.setRequestHeader("Content-Type", "video/mp4");
  xhr.setRequestHeader("X-Filename", file.name.replace(/[^\x20-\x7E]/g, "_"));
  xhr.upload.onprogress = (e) => {
    if (current?.id === id) {
      $("#upload-status").textContent = `Uploading ${
        e.lengthComputable ? Math.round(e.loaded / e.total * 100) + "%" : "…"
      }`;
    }
  };
  xhr.onload = () => {
    if (current?.id !== id) return;
    $("#upload-status").textContent = "";
    try {
      const data = JSON.parse(xhr.responseText);
      if (xhr.status >= 400) throw new Error(data.error);
      update(data);
      loadPreview(data);
      toast("Video uploaded.");
    } catch (e) {
      toast(e.message);
    }
  };
  xhr.onerror = () =>
    toast("Upload failed. Check your connection and try again.");
  xhr.send(file);
}
async function route() {
  const version = ++routeVersion;
  source?.close();
  viewer?.dispose();
  viewer = null;
  current = null;
  try {
    projects = await api("/projects");
    if (version !== routeVersion) return;
    $("#count").textContent = projects.length;
    const id = location.hash.slice(1);
    if (id) {
      const p = await api("/projects/" + id);
      if (version === routeVersion) await renderProject(p);
    } else renderList();
  } catch (e) {
    toast(e.message);
    if (location.hash) location.hash = "";
  }
}
const health = await api("/health");
$("#health-dot").className = health.ready ? "ready" : "missing";
$("#dependencies").innerHTML = health.dependencies.map((d) =>
  `<div class="dependency"><strong>${d.available ? "✓" : "○"} ${
    escape(d.name)
  }</strong><p>${d.available ? "Available" : escape(d.help)}</p></div>`
).join("");
setInterval(() => {
  if (current?.processing.startedAt && $("#elapsed")) {
    const end = current.processing.completedAt
      ? new Date(current.processing.completedAt)
      : new Date();
    $("#elapsed").textContent = `Elapsed: ${
      Math.max(
        0,
        Math.floor((end - new Date(current.processing.startedAt)) / 1000),
      )
    }s`;
  }
}, 1000);
addEventListener("hashchange", route);
route();
