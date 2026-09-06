/* Admin dashboard.
 *
 * The live board arrives over a WebSocket and falls back to polling the exact
 * same endpoint every 10 seconds when the socket will not stay up, so a proxy
 * that kills idle sockets costs freshness and nothing else.
 */

const $ = (id) => document.getElementById(id);
const state = { me: null, config: null, board: null, socket: null, poller: null, people: [], shifts: [] };

/* Report times are rendered in the workplace's timezone, not the viewer's — an
 * HR laptop travelling with its owner must not shift everyone's hours. */
function atWorkplace(value) {
  if (!value) return "—";
  const zone = state.config && state.config.timezone;
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit", minute: "2-digit", ...(zone ? { timeZone: zone } : {}),
  });
}

async function api(path, { method = "GET", form = null } = {}) {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    body: form,
    headers: { "X-Requested-With": "dtr" },
  });
  if (response.status === 401) { showLogin(); throw { message: "Please sign in." }; }
  let body = null;
  try { body = await response.json(); } catch (err) { body = null; }
  if (!response.ok) {
    const detail = body && body.detail;
    if (detail && typeof detail === "object") throw detail;
    throw { message: (typeof detail === "string" && detail) || `Request failed (${response.status}).` };
  }
  return body;
}

function formOf(pairs) {
  const form = new FormData();
  for (const [key, value] of Object.entries(pairs)) {
    if (value !== null && value !== undefined && value !== "") form.append(key, value);
  }
  return form;
}

let bannerTimer = null;
function banner(message, kind = "warn") {
  const element = $("banner");
  element.textContent = message;
  element.className = `notice ${kind}`;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => element.classList.add("hidden"), 6000);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function cells(row, values) {
  for (const value of values) {
    row.append(value instanceof Node ? wrapCell(value) : el("td", null, value ?? ""));
  }
  return row;
}
function wrapCell(node) {
  const td = el("td");
  td.append(node);
  return td;
}

/* -------------------------------------------------------------- live board */

const STATE_LABEL = {
  in: "Clocked in", out: "Clocked out", not_in: "Not in yet",
  late_missing: "Late, no scan", rest_day: "Rest day",
};

function renderBoard(board) {
  state.board = board;
  $("board-date").textContent = board.business_date;

  const counts = $("counts");
  counts.replaceChildren();
  const tiles = [
    ["in", "Clocked in", board.counts.in],
    ["late", "Late, no scan", board.counts.late_missing],
    ["", "Clocked out", board.counts.out],
    ["", "Not in yet", board.counts.not_in],
    ["flagged", "Needs a look", (board.anomalies || []).length],
  ];
  for (const [kind, label, value] of tiles) {
    const tile = el("div", `count ${kind}`.trim());
    tile.append(el("div", "n", value), el("div", "k", label));
    counts.append(tile);
  }

  const filter = ($("board-filter").value || "").toLowerCase();
  const body = $("board-body");
  body.replaceChildren();
  for (const person of board.people) {
    if (filter && !`${person.name} ${person.department} ${person.employee_number}`.toLowerCase().includes(filter)) {
      continue;
    }
    const row = el("tr");
    const name = el("span", null, person.name);
    const number = el("span", "muted tiny", ` ${person.employee_number}`);
    const nameCell = el("span");
    nameCell.append(name, number);
    const stateCell = el("span");
    stateCell.append(el("span", `state-dot state-${person.state}`), el("span", null, STATE_LABEL[person.state]));
    cells(row, [
      nameCell, person.department, person.shift,
      person.time_in || "—", person.time_out || "—",
      person.late_minutes ? `${person.late_minutes} min` : "—",
      stateCell,
    ]);
    if (person.flags.length) {
      row.lastChild.append(" ", el("span", "pill warn", person.flags.join(" ")));
    }
    body.append(row);
  }

  const anomalies = $("anomalies");
  anomalies.replaceChildren();
  if (!(board.anomalies || []).length) {
    anomalies.append(el("p", "muted small", "Nothing flagged. "));
  }
  for (const item of board.anomalies || []) {
    const card = el("div", `anomaly ${item.reasons.includes("unrecognised_device") ? "bad" : ""}`.trim());
    card.append(el("div", "who", `${item.employee} · ${item.employee_number}`));
    card.append(el("div", "small",
      `${item.entry_type.replace("_", " ")} on ${item.business_date} at ${item.at.slice(11)}`));
    card.append(el("div", "tiny muted", item.reasons.join(", ")
      + (item.distance_m !== null ? ` · ${item.distance_m} m out` : "")));
    if (item.has_photo) {
      const link = el("a", "tiny", "View photo");
      link.href = `/api/admin/logs/${item.log_id}/photo`;
      link.target = "_blank";
      link.rel = "noopener";
      card.append(link);
    }
    anomalies.append(card);
  }
}

function connectLive() {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  let socket;
  try {
    socket = new WebSocket(`${scheme}://${location.host}/api/ws/board`);
  } catch (err) {
    startPolling();
    return;
  }
  state.socket = socket;

  socket.addEventListener("open", () => {
    stopPolling();
    $("live-dot").classList.add("on");
    $("live-label").textContent = "live";
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "board") renderBoard(message.board);
    // A scan anywhere means the board is stale: ask for a fresh one.
    if (message.type === "scan") socket.send("refresh");
  });
  socket.addEventListener("close", () => {
    $("live-dot").classList.remove("on");
    $("live-label").textContent = "polling";
    state.socket = null;
    startPolling();
    setTimeout(() => { if (state.me && !state.socket) connectLive(); }, 20000);
  });
  socket.addEventListener("error", () => socket.close());

  // A heartbeat doubles as a refresh, so the board never drifts even if a
  // broadcast is missed.
  setInterval(() => {
    if (socket.readyState === WebSocket.OPEN) socket.send("ping");
  }, 20000);
}

function startPolling() {
  if (state.poller) return;
  const pull = () => api("/api/admin/board").then(renderBoard).catch(() => {});
  pull();
  state.poller = setInterval(pull, 10000);
}
function stopPolling() {
  clearInterval(state.poller);
  state.poller = null;
}

/* --------------------------------------------------------------- approvals */

async function loadApprovals() {
  const rows = await api("/api/admin/corrections");
  $("approvals-badge").textContent = rows.length ? String(rows.length) : "";
  $("approvals-badge").classList.toggle("hidden", !rows.length);
  const container = $("approvals");
  container.replaceChildren();
  if (!rows.length) {
    container.append(el("p", "muted small", "Nothing waiting."));
    return;
  }
  for (const row of rows) {
    const card = el("div", "request");
    card.append(el("div", null, `${row.employee} · ${row.employee_number} · ${row.department}`));
    const kind = String(row.requested_entry_type || "").replace("_", " ");
    const asked = String(row.requested_at || "").slice(11) || row.requested_at;
    const what = row.type === "void"
      ? `Remove the entry recorded at ${row.original ? row.original.at : "?"}`
      : row.type === "amend"
        ? `Change the ${kind} on ${row.business_date} to ${asked}`
        : `Add a missing ${kind} on ${row.business_date} at ${asked}`;
    card.append(el("div", "small", what));
    if (row.original) card.append(el("div", "tiny muted", `Original: ${row.original.entry_type} at ${row.original.at}`));
    card.append(el("div", "reason small", `“${row.reason}”`));

    const actions = el("div", "actions");
    const note = el("input");
    note.placeholder = "Note (required to reject)";
    const approve = el("button", "primary", "Approve");
    const reject = el("button", "danger", "Reject");
    approve.addEventListener("click", async () => {
      approve.disabled = reject.disabled = true;
      try {
        await api(`/api/admin/corrections/${row.id}/approve`, { method: "POST", form: formOf({ note: note.value }) });
        banner("Approved. The original entry is kept and linked to the correction.", "ok");
        await Promise.all([loadApprovals(), refreshBoard()]);
      } catch (error) {
        banner(error.message || "Could not approve.", "bad");
        approve.disabled = reject.disabled = false;
      }
    });
    reject.addEventListener("click", async () => {
      if (!note.value.trim()) { banner("Say why — the employee sees this.", "warn"); note.focus(); return; }
      approve.disabled = reject.disabled = true;
      try {
        await api(`/api/admin/corrections/${row.id}/reject`, { method: "POST", form: formOf({ note: note.value }) });
        banner("Rejected.", "ok");
        await loadApprovals();
      } catch (error) {
        banner(error.message || "Could not reject.", "bad");
        approve.disabled = reject.disabled = false;
      }
    });
    actions.append(note, approve, reject);
    card.append(actions);
    container.append(card);
  }
}

async function refreshBoard() {
  if (state.socket && state.socket.readyState === WebSocket.OPEN) state.socket.send("refresh");
  else await api("/api/admin/board").then(renderBoard).catch(() => {});
}

/* ----------------------------------------------------------------- reports */

function reportQuery() {
  const params = new URLSearchParams();
  if ($("rep-start").value) params.set("start", $("rep-start").value);
  if ($("rep-end").value) params.set("end", $("rep-end").value);
  if ($("rep-dept").value.trim()) params.set("department", $("rep-dept").value.trim());
  if ($("rep-employee").value) params.set("employee_id", $("rep-employee").value);
  return params.toString();
}

async function runReport() {
  const data = await api(`/api/admin/report?${reportQuery()}`);
  const totals = $("rep-totals");
  totals.replaceChildren();
  for (const t of data.totals) {
    totals.append(cells(el("tr"), [
      t.name, t.department, t.worked_hours, t.days_present, t.days_absent,
      t.days_incomplete, t.late_minutes, t.undertime_minutes, t.overtime_minutes,
    ]));
  }
  const rows = $("rep-rows");
  rows.replaceChildren();
  for (const r of data.rows) {
    if (r.status === "rest_day" && !r.time_in) continue;
    rows.append(cells(el("tr"), [
      r.date, r.name, atWorkplace(r.time_in), atWorkplace(r.time_out), r.worked_hours,
      r.late_minutes || "—", r.status, r.flags.join(" ") || "—",
    ]));
  }
  banner(`${data.rows.length} employee-days, ${data.start} to ${data.end}.`, "ok");
}

/* ------------------------------------------------------------------ people */

async function loadPeople() {
  state.shifts = await api("/api/admin/shifts").catch(() => []);
  state.people = await api("/api/admin/employees");

  const shiftSelect = $("p-shift");
  shiftSelect.replaceChildren();
  const none = el("option", null, "No shift (default 08:00–17:00)");
  none.value = "";
  shiftSelect.append(none);
  for (const shift of state.shifts) {
    const option = el("option", null, `${shift.name} · ${shift.start_time}–${shift.end_time}`);
    option.value = shift.id;
    shiftSelect.append(option);
  }

  const picker = $("rep-employee");
  picker.replaceChildren();
  const all = el("option", null, "Everyone");
  all.value = "";
  picker.append(all);

  const body = $("people-body");
  body.replaceChildren();
  for (const person of state.people) {
    const option = el("option", null, person.name);
    option.value = person.id;
    picker.append(option);

    const row = el("tr");
    const status = el("span", `pill ${person.status === "active" ? "ok" : "bad"}`, person.status);
    const phone = el("span", `pill ${person.device_bound ? "ok" : ""}`.trim(), person.device_bound ? "bound" : "none");
    const reset = el("button", "link", "Unbind phone");
    reset.addEventListener("click", async () => {
      const reason = prompt(`Unbind ${person.name}'s phone? Say why — this is recorded.`);
      if (!reason) return;
      try {
        await api(`/api/admin/employees/${person.id}/reset-device`, { method: "POST", form: formOf({ reason }) });
        banner("Unbound. Their next scan will register a new phone.", "ok");
        await loadPeople();
      } catch (error) { banner(error.message, "bad"); }
    });
    cells(row, [person.employee_number, person.name, person.department, person.role, phone, status, reset]);
    body.append(row);
  }
  $("add-person-card").classList.toggle("hidden", state.me.role !== "admin");
}

/* --------------------------------------------------------------- locations */

async function loadLocations() {
  const locations = await api("/api/admin/locations");
  const container = $("locations-list");
  container.replaceChildren();
  for (const location of locations) {
    const card = el("div", "card");
    const head = el("div", "spread");
    head.append(el("h2", null, location.name));
    head.append(el("span", `pill ${location.status === "active" ? "ok" : "bad"}`, location.status));
    card.append(head);

    const poster = el("div", "poster");
    const image = el("img");
    image.src = `/api/admin/locations/${location.id}/qr.svg`;
    image.alt = `QR code for ${location.name}`;
    const facts = el("div", "stack");
    facts.append(el("div", "code mono", location.code));
    facts.append(el("div", "small muted",
      `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)} · ${location.radius_m} m radius`));
    facts.append(el("div", "small muted",
      `Rejects fixes worse than ${location.max_accuracy_m} m · photo ${location.require_photo ? "required" : "off"}`));
    const print = el("button", "no-print", "Print poster");
    print.addEventListener("click", () => window.print());
    facts.append(print);
    poster.append(image, facts);
    card.append(poster);

    const hint = el("p", "tiny muted",
      "Print this and put it at the entrance. Staff scan it with their phone camera, "
      + "or type the code above if the camera will not focus.");
    card.append(hint);
    container.append(card);
  }
}

/* ------------------------------------------------------------------- audit */

async function loadAudit() {
  const type = $("au-type").value;
  const rows = await api(`/api/admin/audit?limit=300${type ? `&entity_type=${type}` : ""}`);
  const body = $("audit-body");
  body.replaceChildren();
  for (const row of rows) {
    const tr = el("tr");
    const before = el("div", "audit-value mono tiny", row.old_value || "");
    const after = el("div", "audit-value mono tiny", row.new_value || "");
    cells(tr, [
      row.at.slice(0, 19).replace("T", " "), row.actor || "—",
      `${row.entity_type} ${row.entity_id}`, row.action, before, after, row.reason || "",
    ]);
    body.append(tr);
  }
}

/* -------------------------------------------------------------- navigation */

const LOADERS = {
  live: refreshBoard,
  approvals: loadApprovals,
  reports: async () => {
    if (!state.people.length) await loadPeople();
    await runReport();  // open with the last fortnight already filled in
  },
  people: loadPeople,
  locations: loadLocations,
  audit: loadAudit,
};

function showSection(name) {
  for (const button of document.querySelectorAll("nav.sections button")) {
    button.setAttribute("aria-current", String(button.dataset.section === name));
  }
  for (const section of ["live", "approvals", "reports", "people", "locations", "audit"]) {
    $(`section-${section}`).classList.toggle("hidden", section !== name);
  }
  (LOADERS[name] || (() => {}))().catch((error) => banner(error.message || "Could not load.", "bad"));
}

function showLogin() {
  state.me = null;
  stopPolling();
  if (state.socket) state.socket.close();
  $("view-login").classList.remove("hidden");
  $("view-main").classList.add("hidden");
}

async function enterDashboard() {
  $("view-login").classList.add("hidden");
  $("view-main").classList.remove("hidden");
  $("who").textContent = `${state.me.name} · ${state.me.role}`;
  state.config = await api("/api/config").catch(() => null);
  if (state.config) $("org-name").textContent = `${state.config.organisation} · DTR`;

  const today = new Date();
  const back = new Date(today.getTime() - 13 * 86400000);
  $("rep-end").value = today.toISOString().slice(0, 10);
  $("rep-start").value = back.toISOString().slice(0, 10);

  connectLive();
  showSection("live");
  loadApprovals().catch(() => {});
}

/* ------------------------------------------------------------------ events */

$("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    state.me = await api("/api/auth/admin/login", {
      method: "POST",
      form: formOf({ employee_number: $("login-number").value, password: $("login-password").value }),
    });
    $("login-password").value = "";
    await enterDashboard();
  } catch (error) {
    banner(error.message || "Could not sign in.", "bad");
  }
});

$("sign-out").addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST" }).catch(() => {});
  showLogin();
});

for (const button of document.querySelectorAll("nav.sections button")) {
  button.addEventListener("click", () => showSection(button.dataset.section));
}

$("board-filter").addEventListener("input", () => { if (state.board) renderBoard(state.board); });
$("rep-run").addEventListener("click", () => runReport().catch((e) => banner(e.message, "bad")));
$("rep-csv").addEventListener("click", () => { location.href = `/api/admin/report.csv?${reportQuery()}`; });
$("au-run").addEventListener("click", () => loadAudit().catch((e) => banner(e.message, "bad")));

$("person-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("/api/admin/employees", {
      method: "POST",
      form: formOf({
        employee_number: $("p-number").value,
        full_name: $("p-name").value,
        department: $("p-dept").value,
        role: $("p-role").value,
        shift_id: $("p-shift").value,
        password: $("p-password").value,
      }),
    });
    $("person-form").reset();
    banner("Added.", "ok");
    await loadPeople();
  } catch (error) {
    banner(error.message || "Could not add that employee.", "bad");
  }
});

$("l-here").addEventListener("click", () => {
  navigator.geolocation.getCurrentPosition(
    (position) => {
      $("l-lat").value = position.coords.latitude.toFixed(6);
      $("l-lng").value = position.coords.longitude.toFixed(6);
      banner(`Filled in from this device (±${Math.round(position.coords.accuracy)} m). `
        + "Stand at the entrance when you do this.", "ok");
    },
    () => banner("Could not read this device's location.", "bad"),
    { enableHighAccuracy: true, timeout: 15000 },
  );
});

$("location-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("/api/admin/locations", {
      method: "POST",
      form: formOf({
        name: $("l-name").value,
        latitude: $("l-lat").value,
        longitude: $("l-lng").value,
        radius_m: $("l-radius").value,
        max_accuracy_m: $("l-accuracy").value,
        require_photo: $("l-photo").checked ? "true" : "false",
      }),
    });
    $("location-form").reset();
    banner("Location added. Print its poster below.", "ok");
    await loadLocations();
  } catch (error) {
    banner(error.message || "Could not add that location.", "bad");
  }
});

api("/api/auth/admin/me")
  .then(async (me) => { state.me = me; await enterDashboard(); })
  .catch(() => showLogin());
