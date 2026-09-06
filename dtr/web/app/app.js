/* Employee PWA.
 *
 * Three things worth knowing before reading:
 *
 * 1. This file never sends a time. It sends a QR payload and a GPS fix; the
 *    server stamps the record with its own clock. Changing the phone's clock
 *    does nothing.
 * 2. The normal way to scan is the phone's own camera app: the poster encodes
 *    a URL into this page with the payload in the hash, so every phone works
 *    without shipping a QR decoder. The in-app scanner is a convenience where
 *    BarcodeDetector exists, and typing the printed code is the last resort.
 * 3. There is no offline queue, by design. No connection means no clock-in.
 */

const $ = (id) => document.getElementById(id);
const state = { me: null, config: null, status: null, payload: null,
                pendingPhoto: null, entries: [], ticker: null };

/* ------------------------------------------------------------------ plumbing */

async function api(path, { method = "GET", form = null } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      body: form,
      headers: { "X-Requested-With": "dtr" },
    });
  } catch (err) {
    throw { code: "offline", message: "No connection. You must be online to clock in." };
  }
  if (response.status === 204) return null;
  let body = null;
  try { body = await response.json(); } catch (err) { body = null; }
  if (!response.ok) {
    const detail = body && body.detail;
    if (detail && typeof detail === "object") {
      if (detail.code === "password_change_required") show("password");
      throw detail;
    }
    throw { code: `http_${response.status}`, message: (typeof detail === "string" && detail) || "Something went wrong." };
  }
  return body;
}

function formOf(pairs) {
  const form = new FormData();
  for (const [key, value] of Object.entries(pairs)) {
    if (value !== null && value !== undefined) form.append(key, value);
  }
  return form;
}

/* Always show the workplace's clock. A phone roaming on a foreign carrier, or
 * one whose owner has changed its timezone, must not display a different time
 * from the one on the record. */
function atWorkplace(value, options) {
  const zone = state.config && state.config.timezone;
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit", minute: "2-digit", ...(zone ? { timeZone: zone } : {}), ...options,
  });
}

function deviceId() {
  let id = localStorage.getItem("dtr.device");
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2));
    localStorage.setItem("dtr.device", id);
  }
  return id;
}

function show(view) {
  for (const section of document.querySelectorAll("main > section")) {
    section.classList.toggle("hidden", section.id !== `view-${view}`);
  }
}

let bannerTimer = null;
function banner(message, kind = "warn", persist = false) {
  const element = $("banner");
  element.textContent = message;
  element.className = `notice ${kind}`;
  clearTimeout(bannerTimer);
  if (!persist) bannerTimer = setTimeout(() => element.classList.add("hidden"), 7000);
}
function clearBanner() { $("banner").classList.add("hidden"); }

/* ------------------------------------------------------------------- location */

function getFix() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject({ code: "location_required", message: "This phone cannot report its location." });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy_m: position.coords.accuracy,
        // How old the phone's fix is. A cached position is the tell-tale of a
        // phone that is not where it claims to be, so the server sees this.
        fix_age_seconds: Math.max(0, (Date.now() - position.timestamp) / 1000),
      }),
      (error) => reject({
        code: "location_required",
        message: error.code === 1
          ? "Location permission is off. Turn it on for this app, then scan again."
          : "Could not get your location. Step outside or near a window and try again.",
      }),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  });
}

/* ----------------------------------------------------------------------- scan */

async function doScan(payload) {
  state.payload = payload;
  const button = $("scan-button");
  const label = $("scan-label");
  button.disabled = true;
  // Two steps, named: a scan takes a second or two and silence reads as broken.
  label.textContent = "Finding you…";
  try {
    const fix = await getFix();
    label.textContent = "Recording…";
    const result = await api("/api/scan", {
      method: "POST",
      form: formOf({
        payload,
        device_id: deviceId(),
        ...fix,
        photo: state.pendingPhoto,
      }),
    });
    state.pendingPhoto = null;
    showResult(result);
  } catch (error) {
    if (error.code === "photo_required" && !state.pendingPhoto) {
      await capturePhotoThenRetry(payload);
      return;
    }
    if (error.code === "photo_consent_required") {
      await openConsent("photo");
      return;
    }
    if (error.code === "consent_required") {
      await openConsent("location");
      return;
    }
    banner(error.message || "The scan was not recorded.", "bad", true);
  } finally {
    state.pendingPhoto = null;
    await refreshStatus();
  }
}

async function capturePhotoThenRetry(payload) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
  } catch (err) {
    banner("This workplace needs a photo with each scan. Allow camera access and try again.", "bad", true);
    return;
  }
  const video = $("camera-preview");
  $("camera-box").classList.remove("hidden");
  $("camera-hint").textContent = "Look at the camera. Taking the photo…";
  video.srcObject = stream;
  await video.play();
  await new Promise((resolve) => setTimeout(resolve, 700));
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth || 480;
  canvas.height = video.videoHeight || 640;
  canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.72));
  stopCamera();
  state.pendingPhoto = new File([blob], "scan.jpg", { type: "image/jpeg" });
  await doScan(payload);
}

function stopCamera() {
  const video = $("camera-preview");
  if (video.srcObject) {
    for (const track of video.srcObject.getTracks()) track.stop();
    video.srcObject = null;
  }
  $("camera-box").classList.add("hidden");
  $("camera-hint").textContent = "Hold the QR code inside the frame.";
}

async function scanWithCamera() {
  if (!("BarcodeDetector" in window)) {
    $("manual-box").classList.remove("hidden");
    $("scan-hint").textContent =
      "This browser cannot scan in the app. Use your phone's camera app on the poster, or type the code below.";
    $("manual-code").focus();
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
  } catch (err) {
    banner("Camera access was refused. Use your phone's camera app on the poster instead.", "warn", true);
    return;
  }
  const detector = new BarcodeDetector({ formats: ["qr_code"] });
  const video = $("camera-preview");
  $("camera-box").classList.remove("hidden");
  video.srcObject = stream;
  await video.play();

  const deadline = Date.now() + 30000;
  const tick = async () => {
    if (!video.srcObject) return;
    try {
      const codes = await detector.detect(video);
      if (codes.length) {
        const raw = codes[0].rawValue;
        stopCamera();
        await doScan(raw);
        return;
      }
    } catch (err) { /* a dropped frame is not an error worth showing */ }
    if (Date.now() > deadline) {
      stopCamera();
      $("manual-box").classList.remove("hidden");
      banner("No code found. Type the code printed under the QR instead.", "warn");
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function showResult(result) {
  const isIn = result.entry_type === "time_in";
  $("result-mark").classList.toggle("out", !isIn);
  const kind = $("result-kind");
  kind.className = `chip ${isIn ? "good" : ""}`.trim();
  kind.replaceChildren(glyph(isIn ? "\u2713" : "\u2192"), document.createTextNode(isIn ? "Timed in" : "Timed out"));
  $("result-time").textContent = result.local_time;
  $("result-detail").textContent =
    `${result.location} \u00b7 ${formatDay(result.business_date)}` +
    (result.distance_m !== null ? ` \u00b7 ${Math.round(result.distance_m)} m from the marker` : "");

  const notes = $("result-notes");
  notes.replaceChildren();
  for (const note of result.notes || []) {
    const p = document.createElement("p");
    p.className = "notice warn";
    p.textContent = note;
    notes.append(p);
  }
  show("result");
}

function glyph(character) {
  const span = document.createElement("span");
  span.className = "glyph";
  span.setAttribute("aria-hidden", "true");
  span.textContent = character;
  return span;
}

function formatDay(iso) {
  const date = new Date(`${iso}T00:00:00`);
  return date.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
}

/* -------------------------------------------------------------------- consent */

async function openConsent(kind) {
  const notices = await api("/api/consent");
  const notice = notices[kind];
  $("consent-title").textContent = notice.title;
  $("consent-body").textContent = notice.body;
  $("consent-accept").dataset.kind = kind;
  show("consent");
}

/* ---------------------------------------------------------------------- views */

async function refreshStatus() {
  if (!state.me) return;
  try {
    state.status = await api("/api/my/status");
  } catch (error) {
    $("state-line").textContent = error.message || "Could not reach the server.";
    return;
  }
  renderStatus();
}

/* One card answering the only two questions that matter on this screen:
 * am I in, and how long have I been. */
function renderStatus() {
  const status = state.status;
  if (!status) return;
  const button = $("scan-button");
  const chip = $("status-chip");
  const word = $("status-word");

  button.disabled = false;
  $("scan-label").textContent = status.clocked_in ? "Scan to clock out" : "Scan to clock in";
  button.classList.toggle("out", status.clocked_in);
  $("status-card").classList.toggle("is-in", status.clocked_in);
  $("status-date").textContent = formatDay(status.business_date);

  if (status.clocked_in) {
    chip.className = "chip good";
    word.textContent = "Clocked in";
    chip.firstChild.textContent = "\u25cf";
  } else if (!status.scheduled_today) {
    chip.className = "chip";
    word.textContent = "Rest day";
    chip.firstChild.textContent = "\u25cb";
  } else {
    chip.className = "chip";
    word.textContent = status.last_scan ? "Clocked out" : "Not in yet";
    chip.firstChild.textContent = "\u25cb";
  }

  const shift = status.shift;
  $("home-shift").textContent = shift ? `${shift.name} \u00b7 ${shift.start_time}\u2013${shift.end_time}` : "";

  if (status.clocked_in) {
    const line = [`Since ${atWorkplace(status.since)}`];
    if (status.late_minutes > 0) line.push(`${describeMinutes(status.late_minutes)} late`);
    $("state-line").textContent = line.join(" \u00b7 ");
  } else if (status.last_scan) {
    // The server sends "YYYY-MM-DD HH:MM"; show it the way the rest of the
    // screen writes a date.
    const [day, time] = status.last_scan.at.split(" ");
    $("state-line").textContent = `Last scan ${formatDay(day)} at ${time}`;
  } else {
    $("state-line").textContent = status.scheduled_today
      ? "Scan the poster by the door to start your day"
      : "You are not scheduled today";
  }

  tickFigure();
}

function describeMinutes(total) {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (!hours) return `${minutes}m`;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

/* The hero number: time worked so far when clocked in, the clock when not. */
function tickFigure() {
  const status = state.status;
  const figure = $("wall-clock");
  const meter = $("status-meter");

  if (!status || !status.clocked_in) {
    figure.textContent = atWorkplace(Date.now());
    meter.classList.add("hidden");
    return;
  }
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(status.since).getTime()) / 60000));
  figure.replaceChildren(
    document.createTextNode(String(Math.floor(minutes / 60))), unit("h"),
    document.createTextNode(String(minutes % 60).padStart(2, "0")), unit("m"),
  );

  const required = (status.shift && status.shift.required_minutes) || 0;
  if (!required) { meter.classList.add("hidden"); return; }
  const share = Math.min(1, minutes / required);
  meter.classList.remove("hidden");
  $("status-meter-fill").style.width = `${(share * 100).toFixed(1)}%`;
  $("status-meter-label").textContent = minutes >= required
    ? `Full day done \u00b7 ${describeMinutes(minutes - required)} over`
    : `${describeMinutes(required - minutes)} to a full day`;
}

function unit(text) {
  const span = document.createElement("span");
  span.className = "unit";
  span.textContent = text;
  return span;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function renderHistory(data) {
  const days = (data.days || []).filter((d) => d.time_in || d.status === "absent" || d.status === "incomplete");

  const summary = $("week-summary");
  summary.replaceChildren();
  const recent = days.slice(-7);
  const tiles = [
    ["Hours", recent.reduce((sum, d) => sum + d.worked_hours, 0).toFixed(1)],
    ["Days in", String(recent.filter((d) => d.time_in).length)],
    ["Late", String(recent.reduce((sum, d) => sum + (d.late_minutes ? 1 : 0), 0))],
  ];
  const grid = el("div", "summary-tiles");
  for (const [label, value] of tiles) {
    const tile = el("div", "summary-tile");
    tile.append(el("div", "n", value), el("div", "k", label));
    grid.append(tile);
  }
  // A number with no window on it is not a fact.
  summary.append(el("div", "summary-caption tiny faint", "Last 7 days"), grid);

  const list = $("history-list");
  list.replaceChildren();
  if (!days.length) {
    const empty = el("div", "empty");
    empty.append(el("span", "glyph", "\u25f7"), el("div", null, "Nothing recorded yet."));
    list.append(empty);
    return;
  }

  const longest = Math.max(8, ...days.map((d) => d.worked_hours));
  for (const day of days.slice().reverse()) {
    const row = el("div", "day");
    const when = el("div", "day-when");
    const date = new Date(`${day.date}T00:00:00`);
    when.append(el("span", null, date.toLocaleDateString([], { day: "numeric", month: "short" })),
                el("span", "day-dow", date.toLocaleDateString([], { weekday: "short" })));
    const times = el("div", "day-times",
      `${day.time_in ? atWorkplace(day.time_in) : "\u2014"} \u2192 ${day.time_out ? atWorkplace(day.time_out) : "\u2014"}`);
    row.append(when, times);

    const meta = el("div", "day-meta");
    const bar = el("div", "meter");
    const fill = document.createElement("span");
    fill.style.width = `${Math.round((day.worked_hours / longest) * 100)}%`;
    bar.append(fill);
    meta.append(statusChip(day), bar, el("span", "day-hours", `${day.worked_hours.toFixed(2)} h`));
    row.append(meta);
    list.append(row);
  }

  const select = $("corr-log");
  select.replaceChildren();
  state.entries = data.entries || [];
  for (const entry of state.entries.slice().reverse()) {
    const option = el("option", null,
      `${entry.business_date} \u00b7 ${entry.entry_type.replace("_", " ")} \u00b7 ${entry.at}`);
    option.value = entry.id;
    select.append(option);
  }
}

const DAY_STATUS = {
  present:     ["good", "\u2713", "On time"],
  late:        ["warning", "\u26a0", "Late"],
  absent:      ["critical", "\u2715", "Absent"],
  incomplete:  ["warning", "\u26a0", "No time out"],
  unscheduled: ["", "\u25cb", "Rest day worked"],
  rest_day:    ["", "\u25cb", "Rest day"],
};

function statusChip(day) {
  const [tone, mark, label] = DAY_STATUS[day.status] || ["", "\u25cb", day.status];
  const chip = el("span", `chip ${tone}`.trim());
  chip.append(glyph(mark), document.createTextNode(
    day.status === "late" && day.late_minutes ? `${describeMinutes(day.late_minutes)} late` : label));
  return chip;
}

const REQUEST_STATUS = {
  pending:   ["warning", "\u25cf", "Waiting"],
  approved:  ["good", "\u2713", "Approved"],
  rejected:  ["critical", "\u2715", "Rejected"],
  cancelled: ["", "\u25cb", "Cancelled"],
};

function renderRequests(rows) {
  const list = $("requests-list");
  list.replaceChildren();
  if (!rows.length) {
    const empty = el("div", "empty");
    empty.append(el("span", "glyph", "\u2713"),
                 el("div", null, "You have not asked for any corrections."));
    list.append(empty);
    return;
  }
  for (const row of rows) {
    const item = el("div", "request-row");
    const left = el("div", "grow");
    left.append(el("div", "day-when",
      `${formatDay(row.business_date)} \u00b7 ${row.type.replace("_", " ")}`));
    left.append(el("div", "tiny muted", row.reason));
    if (row.review_note) left.append(el("div", "tiny faint", `Reviewer: ${row.review_note}`));
    const [tone, mark, label] = REQUEST_STATUS[row.status] || ["", "\u25cb", row.status];
    const chip = el("span", `chip ${tone}`.trim());
    chip.append(glyph(mark), document.createTextNode(label));
    item.append(left, chip);
    list.append(item);
  }
}

function selectTab(name) {
  for (const tab of ["now", "history", "requests"]) {
    $(`tab-${tab}`).setAttribute("aria-selected", String(tab === name));
    $(`panel-${tab}`).classList.toggle("hidden", tab !== name);
  }
  if (name === "history") api("/api/my/logs?days=30").then(renderHistory).catch((e) => banner(e.message, "bad"));
  if (name === "requests") api("/api/my/corrections").then(renderRequests).catch((e) => banner(e.message, "bad"));
}

/* ----------------------------------------------------------------------- boot */

function payloadFromHash() {
  const match = /(?:^|[#&])c=([^&]+)/.exec(location.hash || "");
  return match ? decodeURIComponent(match[1]) : null;
}

async function start() {
  state.config = await api("/api/config").catch(() => ({ organisation: "Time Record" }));
  $("org-name").textContent = state.config.organisation || "Time Record";
  document.title = `Time Record · ${state.config.organisation || ""}`.trim();

  try {
    state.me = await api("/api/auth/me");
  } catch (error) {
    state.me = null;
  }

  const queued = payloadFromHash();
  if (queued) history.replaceState(null, "", location.pathname);

  if (state.me && state.me.must_change_password) {
    // The server refuses every other route until this is done; the screen just
    // explains why rather than letting them walk into a wall of 403s.
    if (queued) sessionStorage.setItem("dtr.pendingPayload", queued);
    show("password");
    return;
  }

  if (!state.me) {
    show("login");
    if (queued) {
      sessionStorage.setItem("dtr.pendingPayload", queued);
      banner("Sign in first, then your scan will go through.", "warn", true);
    }
    return;
  }
  if (!state.me.consent_location) {
    await openConsent("location");
    if (queued) sessionStorage.setItem("dtr.pendingPayload", queued);
    return;
  }

  $("home-name").textContent = state.me.name;
  show("home");
  selectTab("now");
  await refreshStatus();
  if (!state.ticker) state.ticker = setInterval(tickFigure, 1000);

  const pending = queued || sessionStorage.getItem("dtr.pendingPayload");
  if (pending) {
    sessionStorage.removeItem("dtr.pendingPayload");
    await doScan(pending);
  }
}

/* --------------------------------------------------------------------- events */

$("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  clearBanner();
  const button = event.currentTarget.querySelector("button");
  button.disabled = true;
  try {
    await api("/api/auth/login", {
      method: "POST",
      form: formOf({
        employee_number: $("login-number").value,
        password: $("login-password").value,
        device_id: deviceId(),
      }),
    });
    $("login-password").value = "";
    await start();
  } catch (error) {
    banner(error.message || "Could not sign in.", "bad", true);
  } finally {
    button.disabled = false;
  }
});

$("password-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if ($("pw-new").value !== $("pw-again").value) {
    banner("Those two do not match.", "warn");
    return;
  }
  const button = event.currentTarget.querySelector("button");
  button.disabled = true;
  try {
    await api("/api/auth/password", {
      method: "POST",
      form: formOf({ current_password: $("pw-current").value, new_password: $("pw-new").value }),
    });
    $("password-form").reset();
    state.me = null;
    show("login");
    banner("Saved. Sign in again with your new password.", "ok", true);
  } catch (error) {
    banner(error.message || "That password was not accepted.", "bad", true);
  } finally {
    button.disabled = false;
  }
});

$("consent-accept").addEventListener("click", async (event) => {
  const kind = event.currentTarget.dataset.kind || "location";
  try {
    await api("/api/consent", { method: "POST", form: formOf({ kind }) });
    state.me = await api("/api/auth/me");
    await start();
  } catch (error) {
    banner(error.message, "bad", true);
  }
});

$("consent-decline").addEventListener("click", () => {
  banner("You cannot clock in by QR without accepting the notice. Speak to HR.", "warn", true);
  show(state.me ? "home" : "login");
});

$("scan-button").addEventListener("click", scanWithCamera);
$("camera-cancel").addEventListener("click", stopCamera);
$("manual-submit").addEventListener("click", () => {
  const code = $("manual-code").value.trim();
  if (code) doScan(code);
});
$("result-done").addEventListener("click", () => { show("home"); selectTab("now"); });
$("tab-now").addEventListener("click", () => selectTab("now"));
$("tab-history").addEventListener("click", () => selectTab("history"));
$("tab-requests").addEventListener("click", () => selectTab("requests"));

$("sign-out").addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST" }).catch(() => {});
  state.me = null;
  show("login");
});

$("corr-type").addEventListener("change", () => {
  const type = $("corr-type").value;
  $("corr-log-wrap").classList.toggle("hidden", type === "add_missing");
  $("corr-time-wrap").classList.toggle("hidden", type === "void");
  $("corr-entry-wrap").classList.toggle("hidden", type === "void");
});

$("correction-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const type = $("corr-type").value;
  const day = $("corr-date").value;
  const time = $("corr-time").value;
  try {
    await api("/api/my/corrections", {
      method: "POST",
      form: formOf({
        request_type: type,
        business_date: day,
        reason: $("corr-reason").value,
        dtr_log_id: type === "add_missing" ? null : $("corr-log").value,
        requested_entry_type: type === "void" ? null : $("corr-entry").value,
        requested_at: type === "void" ? null : `${day} ${time}`,
      }),
    });
    $("correction-form").reset();
    banner("Sent. A supervisor will review it.", "ok");
    selectTab("requests");
  } catch (error) {
    banner(error.message || "That request was not accepted.", "bad", true);
  }
});

/* Scanning the poster while the app is already open does not reload the page —
 * the browser (or the installed PWA) just changes the fragment and focuses the
 * existing window. Without this the employee sees nothing happen and concludes
 * the system is broken. */
window.addEventListener("hashchange", async () => {
  const queued = payloadFromHash();
  if (!queued) return;
  history.replaceState(null, "", location.pathname);
  if (state.me && state.me.consent_location && !state.me.must_change_password) {
    clearBanner();
    await doScan(queued);
    return;
  }
  sessionStorage.setItem("dtr.pendingPayload", queued);
  await start();
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

start().catch((error) => banner(error.message || "Could not start.", "bad", true));
