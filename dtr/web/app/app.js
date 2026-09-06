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
const state = { me: null, config: null, payload: null, pendingPhoto: null, entries: [] };

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
  button.disabled = true;
  button.textContent = "Checking where you are…";
  try {
    const fix = await getFix();
    button.textContent = "Recording…";
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
  $("result-kind").textContent = isIn ? "Timed in" : "Timed out";
  $("result-kind").className = `pill ${isIn ? "ok" : "warn"}`;
  $("result-time").textContent = result.local_time;
  $("result-detail").textContent =
    `${result.location} · ${result.business_date}` +
    (result.distance_m !== null ? ` · ${Math.round(result.distance_m)} m from the marker` : "");
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
    const status = await api("/api/my/status");
    const button = $("scan-button");
    button.disabled = false;
    button.textContent = status.clocked_in ? "Scan to clock out" : "Scan to clock in";
    button.classList.toggle("out", status.clocked_in);
    $("state-line").textContent = status.clocked_in
      ? `Clocked in since ${atWorkplace(status.since)}`
      : (status.last_scan ? `Last scan: ${status.last_scan.at}` : "Not clocked in yet today");
  } catch (error) {
    $("state-line").textContent = error.message || "Could not reach the server.";
  }
}

function renderHistory(data) {
  const list = $("history-list");
  list.replaceChildren();
  const days = (data.days || []).filter((d) => d.time_in || d.status === "absent" || d.status === "incomplete");
  if (!days.length) {
    list.textContent = "Nothing recorded yet.";
    return;
  }
  for (const day of days.slice().reverse()) {
    const row = document.createElement("div");
    row.className = "day";
    const left = document.createElement("div");
    const when = document.createElement("div");
    when.className = "when";
    when.textContent = day.date;
    const meta = document.createElement("div");
    meta.className = "muted tiny";
    meta.textContent = day.status + (day.late_minutes ? ` · ${day.late_minutes} min late` : "");
    left.append(when, meta);
    const right = document.createElement("div");
    right.className = "times center";
    const times = document.createElement("div");
    const hhmm = (value) => (value ? atWorkplace(value) : "—");
    times.textContent = `${hhmm(day.time_in)} → ${hhmm(day.time_out)}`;
    const hours = document.createElement("div");
    hours.className = "muted tiny";
    hours.textContent = `${day.worked_hours} h`;
    right.append(times, hours);
    row.append(left, right);
    list.append(row);
  }

  const select = $("corr-log");
  select.replaceChildren();
  state.entries = data.entries || [];
  for (const entry of state.entries.slice().reverse()) {
    const option = document.createElement("option");
    option.value = entry.id;
    option.textContent = `${entry.business_date} · ${entry.entry_type.replace("_", " ")} · ${entry.at}`;
    select.append(option);
  }
}

function renderRequests(rows) {
  const list = $("requests-list");
  list.replaceChildren();
  if (!rows.length) {
    list.textContent = "You have not asked for any corrections.";
    return;
  }
  for (const row of rows) {
    const item = document.createElement("div");
    item.className = "day";
    const left = document.createElement("div");
    const head = document.createElement("div");
    head.className = "when";
    head.textContent = `${row.business_date} · ${row.type.replace("_", " ")}`;
    const reason = document.createElement("div");
    reason.className = "muted tiny";
    reason.textContent = row.review_note ? `${row.reason} — reviewer: ${row.review_note}` : row.reason;
    left.append(head, reason);
    const pill = document.createElement("span");
    pill.className = `pill ${row.status === "approved" ? "ok" : row.status === "rejected" ? "bad" : ""}`;
    pill.textContent = row.status;
    item.append(left, pill);
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

function tickClock() {
  $("wall-clock").textContent = atWorkplace(Date.now());
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
  tickClock();
  setInterval(tickClock, 15000);
  await refreshStatus();

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
