/* Admin dashboard.
 *
 * The live board arrives over a WebSocket and falls back to polling the exact
 * same endpoint every 10 seconds when the socket will not stay up, so a proxy
 * that kills idle sockets costs freshness and nothing else.
 */

const $ = (id) => document.getElementById(id);
const state = { me: null, config: null, board: null, report: null,
                socket: null, poller: null, people: [], shifts: [] };

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
    if (detail && typeof detail === "object") {
      if (detail.code === "password_change_required") showOnly("password");
      throw detail;
    }
    throw { message: (typeof detail === "string" && detail) || `Request failed (${response.status}).` };
  }
  return body;
}

/* Three top-level screens: sign in, choose a password, the dashboard itself. */
function showOnly(name) {
  for (const view of ["login", "password", "main"]) {
    document.getElementById(`view-${view}`).classList.toggle("hidden", view !== name);
  }
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

/* Presence states. Each carries a glyph and a word: the colour is a second
 * channel, never the only one — two of the status hues sit below 3:1 on a
 * light surface and could not carry meaning alone. */
const STATE = {
  in:           { label: "Clocked in",   glyph: "\u25cf", tone: "good" },
  out:          { label: "Clocked out",  glyph: "\u2713", tone: "" },
  not_in:       { label: "Not in yet",   glyph: "\u25cb", tone: "" },
  late_missing: { label: "Late, no scan", glyph: "\u26a0", tone: "critical" },
  rest_day:     { label: "Rest day",     glyph: "\u2014", tone: "" },
};

/* Flag codes are how the server names a condition. They are not how a
 * supervisor should have to read one. */
const FLAG_LABELS = {
  unrecognised_device: "Unrecognised phone",
  edge_of_geofence: "At the edge of the geofence",
  missing_time_out: "No time out",
  improbably_long_shift: "Improbably long shift",
  photo_missing: "Photo missing",
};

function describeFlag(code) {
  return FLAG_LABELS[code] || code.replace(/_/g, " ");
}

function describeMinutes(total) {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (!hours) return `${minutes} min`;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

function initials(name) {
  const parts = String(name).trim().split(/\s+/);
  return ((parts[0] || "")[0] || "" ) + ((parts[parts.length - 1] || "")[0] || "");
}

function renderBoard(board) {
  state.board = board;
  $("board-date").textContent = board.business_date;

  const counts = $("counts");
  counts.replaceChildren();
  const expected = board.counts.in + board.counts.out + board.counts.not_in + board.counts.late_missing;
  const tiles = [
    ["good", "Clocked in", board.counts.in, `of ${expected} expected today`],
    ["critical", "Late, no scan", board.counts.late_missing, "past their start time"],
    ["", "Clocked out", board.counts.out, "finished for the day"],
    ["warning", "Needs a look", (board.anomalies || []).length, "flagged, last 7 days"],
  ];
  for (const [tone, label, value, sub] of tiles) {
    const tile = el("div", `count ${tone}`.trim());
    tile.append(el("div", "n", value), el("div", "k", label), el("div", "tiny faint", sub));
    counts.append(tile);
  }

  const filter = ($("board-filter").value || "").toLowerCase();
  const grid = $("board-grid");
  const body = $("board-body");
  grid.replaceChildren();
  body.replaceChildren();

  const shown = board.people.filter((person) => !filter
    || `${person.name} ${person.department} ${person.employee_number}`.toLowerCase().includes(filter));

  if (!shown.length) {
    const empty = el("div", "empty");
    empty.append(el("span", "glyph", "\u2205"),
                 el("div", null, filter ? "Nobody matches that filter." : "No active employees yet."));
    grid.append(empty);
  }

  for (const person of shown) {
    const meta = STATE[person.state] || STATE.not_in;
    const card = el("div", "person");
    if (person.state === "in") card.classList.add("is-in");
    if (person.state === "late_missing") card.classList.add("is-late");

    card.append(el("div", "person-mark", initials(person.name).toUpperCase()));
    const bodyCell = el("div", "person-body grow");
    bodyCell.append(el("div", "person-name truncate", person.name));

    const times = person.time_in
      ? `${person.time_in} \u2192 ${person.time_out || "\u2026"}`
      : meta.label;
    const line = person.state === "late_missing" && person.late_minutes
      ? `${meta.glyph} ${describeMinutes(person.late_minutes)} late`
      : `${meta.glyph} ${times}`;
    bodyCell.append(el("div", "person-meta truncate", line));
    if (person.flags.length) {
      bodyCell.append(el("div", "person-flag chip warning",
        person.flags.map(describeFlag).join(" \u00b7 ")));
    }
    card.append(bodyCell);
    grid.append(card);

    // The same rows, for a screen reader and for anyone who wants the detail.
    body.append(cells(el("tr"), [
      `${person.name} ${person.employee_number}`, person.department, person.shift,
      person.time_in || "\u2014", person.time_out || "\u2014",
      person.late_minutes ? describeMinutes(person.late_minutes) : "\u2014",
      meta.label + (person.flags.length ? ` (${person.flags.map(describeFlag).join(", ")})` : ""),
    ]));
  }

  const anomalies = $("anomalies");
  anomalies.replaceChildren();
  if (!(board.anomalies || []).length) {
    const empty = el("div", "empty");
    empty.append(el("span", "glyph", "\u2713"), el("div", null, "Nothing flagged."));
    anomalies.append(empty);
  }
  for (const item of board.anomalies || []) {
    const severe = item.reasons.includes("unrecognised_device");
    const card = el("div", `anomaly ${severe ? "critical" : ""}`.trim());
    card.append(el("div", "anomaly-glyph", severe ? "\u26a0" : "\u25cb"));
    const bodyCell = el("div", "grow");
    bodyCell.append(el("div", "who", `${item.employee} \u00b7 ${item.employee_number}`));
    bodyCell.append(el("div", "tiny muted",
      `${item.entry_type.replace("_", " ")} on ${item.business_date} at ${item.at.slice(11)}`));
    const detail = [item.reasons.map(describeFlag).join(", ")];
    // A distance is only worth the space when it is actually unusual.
    if (item.distance_m !== null && item.distance_m >= 1) {
      detail.push(`${Math.round(item.distance_m)} m from the marker`);
    }
    bodyCell.append(el("div", "tiny faint", detail.filter(Boolean).join(" \u00b7 ")));
    if (item.has_photo) {
      const link = el("a", "tiny", "View photo");
      link.href = `/api/admin/logs/${item.log_id}/photo`;
      link.target = "_blank";
      link.rel = "noopener";
      bodyCell.append(link);
    }
    card.append(bodyCell);
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
    const empty = el("div", "empty");
    empty.append(el("span", "glyph", "\u2713"), el("div", null, "Nothing waiting for review."));
    container.append(empty);
    return;
  }
  for (const row of rows) {
    const card = el("div", "request");
    const head = el("div", "request-head");
    head.append(el("span", "request-who", row.employee),
                el("span", "chip", `${row.employee_number} · ${row.department}`));
    card.append(head);

    const kind = String(row.requested_entry_type || "").replace("_", " ");
    const asked = String(row.requested_at || "").slice(11) || row.requested_at;
    const what = row.type === "void"
      ? `Remove the entry recorded at ${row.original ? row.original.at : "?"}`
      : row.type === "amend"
        ? `Change the ${kind} on ${row.business_date} to ${asked}`
        : `Add a missing ${kind} on ${row.business_date} at ${asked}`;
    card.append(el("div", "ask", what));
    if (row.original) {
      card.append(el("div", "tiny faint",
        `Currently: ${row.original.entry_type.replace("_", " ")} at ${row.original.at}`));
    }
    card.append(el("div", "reason", row.reason));

    const actions = el("div", "actions");
    const note = el("input");
    note.placeholder = "Note (required to reject)";
    note.setAttribute("aria-label", `Review note for ${row.employee}`);
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
  state.report = data;

  // Lead with the period's shape; the per-employee table answers "who", and the
  // day-by-day wall stays folded away until somebody actually wants a day.
  const worked = data.rows.filter((r) => r.time_in);
  const hours = data.totals.reduce((sum, t) => sum + t.worked_hours, 0);
  const summary = $("rep-summary");
  summary.replaceChildren();
  const tiles = [
    ["", "Hours worked", hours.toFixed(1), `${data.start} to ${data.end}`],
    ["", "People", String(data.totals.length), "in this view"],
    ["warning", "Late arrivals", String(worked.filter((r) => r.late_minutes > 0).length), "days started late"],
    ["critical", "Open days", String(data.rows.filter((r) => r.status === "incomplete").length),
     "clocked in, never out"],
  ];
  for (const [tone, label, value, sub] of tiles) {
    const tile = el("div", `count ${tone}`.trim());
    tile.append(el("div", "n", value), el("div", "k", label), el("div", "tiny faint", sub));
    summary.append(tile);
  }

  const mostHours = Math.max(1, ...data.totals.map((t) => t.worked_hours));
  const totals = $("rep-totals");
  totals.replaceChildren();
  for (const t of data.totals) {
    const share = el("div", "share");
    const bar = el("div", "meter");
    const fill = document.createElement("span");
    fill.style.width = `${Math.round((t.worked_hours / mostHours) * 100)}%`;
    bar.append(fill);
    share.append(bar);
    const row = cells(el("tr"), [t.name, t.department]);
    row.append(numCell(t.worked_hours.toFixed(2)));
    row.append(wrapCell(share));
    for (const value of [t.days_present, t.days_absent, t.days_incomplete]) {
      row.append(numCell(value || "—"));
    }
    // Durations as durations. "6720" is a number; "112h" is an answer.
    for (const minutes of [t.late_minutes, t.undertime_minutes, t.overtime_minutes]) {
      row.append(numCell(minutes ? describeMinutes(minutes) : "—"));
    }
    totals.append(row);
  }

  renderReportRows();
  banner(`${data.rows.length} employee-days, ${data.start} to ${data.end}.`, "ok");
}

function numCell(value) {
  const td = el("td", "num", value);
  return td;
}

function renderReportRows() {
  const data = state.report;
  if (!data) return;
  const workedOnly = $("rep-worked-only").checked;
  const rows = $("rep-rows");
  rows.replaceChildren();
  const shown = data.rows.filter((r) => (workedOnly ? r.time_in : r.status !== "rest_day"));
  for (const r of shown) {
    const row = cells(el("tr"), [r.date, r.name, atWorkplace(r.time_in), atWorkplace(r.time_out)]);
    row.append(numCell(r.worked_hours.toFixed(2)));
    row.append(numCell(r.late_minutes ? describeMinutes(r.late_minutes) : "—"));
    row.append(wrapCell(dayStatusChip(r)));
    row.append(el("td", "tiny muted", r.flags.map(describeFlag).join(", ") || "—"));
    rows.append(row);
  }
  $("rep-rowcount").textContent = `${shown.length} of ${data.rows.length} rows`;
}

const DAY_TONE = {
  present: ["good", "\u2713"], late: ["warning", "\u26a0"],
  absent: ["critical", "\u2715"], incomplete: ["critical", "\u26a0"],
  unscheduled: ["", "\u25cb"], rest_day: ["", "\u2014"],
};

function dayStatusChip(row) {
  const [tone, mark] = DAY_TONE[row.status] || ["", "\u25cb"];
  const chip = el("span", `chip ${tone}`.trim());
  const glyph = el("span", "glyph", mark);
  glyph.setAttribute("aria-hidden", "true");
  chip.append(glyph, document.createTextNode(row.status.replace("_", " ")));
  return chip;
}

/* ------------------------------------------------------------------ people */

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function buildDayToggles() {
  const holder = $("s-days");
  if (holder.childElementCount) return;
  DAY_NAMES.forEach((name, index) => {
    const wrap = el("span", "day-toggle");
    const box = el("input");
    box.type = "checkbox";
    box.id = `s-day-${index}`;
    // defaultChecked, not checked: form.reset() after a submit restores the
    // HTML default, so setting only .checked would silently clear every day.
    box.defaultChecked = index < 5;   // Monday to Friday
    box.checked = index < 5;
    const label = el("label", null, name);
    label.htmlFor = box.id;
    wrap.append(box, label);
    holder.append(wrap);
  });
}

function renderShifts() {
  const list = $("shift-list");
  list.replaceChildren();
  if (!state.shifts.length) {
    list.append(el("p", "muted small", "No shifts yet — everyone is on the 08:00–17:00 default."));
    return;
  }
  for (const shift of state.shifts) {
    const row = el("div", "shift-row");
    row.append(el("span", null, shift.name));
    const days = DAY_NAMES.filter((_, i) => shift.workdays[i] === "1").join(" ");
    row.append(el("span", "muted tiny", `${shift.start_time}–${shift.end_time} · ${days}`));
    list.append(row);
  }
}

async function loadPeople() {
  state.shifts = await api("/api/admin/shifts").catch(() => []);
  state.people = await api("/api/admin/employees");
  buildDayToggles();
  renderShifts();

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
  const adminOnly = state.me.role !== "admin";
  $("add-person-card").classList.toggle("hidden", adminOnly);
  $("shift-form").classList.toggle("hidden", adminOnly);
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
    const buttons = el("div", "row");
    const print = el("a", "button no-print", "Open printable poster");
    print.href = `/admin/poster?location=${location.id}`;
    print.target = "_blank";
    print.rel = "noopener";
    buttons.append(print);

    // Try the whole flow without deploying. This link deliberately ignores
    // base_url and uses whatever origin this dashboard is actually open on —
    // so on the machine running the server it is localhost, which browsers
    // treat as a secure context and will give a location to.
    const fragment = String(location.scan_url).split("#")[1] || "";
    const tryIt = el("a", "button no-print", "Test on this device");
    tryIt.href = `${window.location.origin}/app/#${fragment}`;
    tryIt.target = "_blank";
    tryIt.rel = "noopener";
    buttons.append(tryIt);
    facts.append(buttons);
    poster.append(image, facts);
    card.append(poster);

    if (state.config && state.config.poster_problem) {
      const warn = el("p", "notice warn small");
      warn.append(document.createTextNode(state.config.poster_problem
        + " Until then, use Test on this device to try the flow in this browser."));
      card.append(warn);
    }
    const hint = el("p", "tiny muted",
      "Print this and put it at the entrance. Staff scan it with their phone camera, "
      + "or type the code above if the camera will not focus.");
    card.append(hint);
    const url = el("p", "tiny faint mono");
    url.textContent = location.scan_url;
    card.append(url);
    container.append(card);
  }
}

/* ------------------------------------------------------------------- audit */

async function loadAudit() {
  const type = $("au-type").value;
  const rows = await api(`/api/admin/audit?limit=300${type ? `&entity_type=${type}` : ""}`);
  const body = $("audit-body");
  body.replaceChildren();
  if (!rows.length) {
    const cell = el("td", "empty", "Nothing recorded for that filter yet.");
    cell.colSpan = 7;
    const empty = el("tr");
    empty.append(cell);
    body.append(empty);
    return;
  }
  for (const row of rows) {
    const tr = el("tr");
    cells(tr, [
      row.at.slice(0, 19).replace("T", " "), row.actor || "—",
      `${row.entity_type} ${row.entity_id}`, row.action,
    ]);
    tr.append(wrapCell(readableValue(row.old_value)), wrapCell(readableValue(row.new_value)));
    tr.append(el("td", "tiny muted", row.reason || ""));
    body.append(tr);
  }
}

/* A JSON blob in a table cell is technically the whole truth and practically
 * unreadable. Same fields, one per line, keys quiet. */
function readableValue(raw) {
  const holder = el("div", "audit-diff audit-value");
  if (!raw) {
    holder.textContent = "—";
    return holder;
  }
  let parsed;
  try { parsed = JSON.parse(raw); } catch (err) { holder.textContent = raw; return holder; }
  if (parsed === null || typeof parsed !== "object") {
    holder.textContent = String(parsed);
    return holder;
  }
  for (const [key, value] of Object.entries(parsed)) {
    const line = el("span");
    line.append(el("span", "audit-key", `${key}: `),
                document.createTextNode(Array.isArray(value) ? value.join(" ") : String(value)));
    holder.append(line);
  }
  return holder;
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
  showOnly("login");
}

async function enterDashboard() {
  if (state.me.must_change_password) {
    // Every dashboard route refuses this session until the password is theirs.
    showOnly("password");
    return;
  }
  showOnly("main");
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
    showLogin();
    banner("Saved. Sign in again with your new password.", "ok");
  } catch (error) {
    banner(error.message || "That password was not accepted.", "bad");
  } finally {
    button.disabled = false;
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
$("rep-worked-only").addEventListener("change", renderReportRows);

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

$("shift-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const workdays = DAY_NAMES.map((_, i) => ($(`s-day-${i}`).checked ? "1" : "0")).join("");
  if (!workdays.includes("1")) {
    banner("A shift needs at least one working day.", "warn");
    return;
  }
  try {
    await api("/api/admin/shifts", {
      method: "POST",
      form: formOf({
        name: $("s-name").value,
        start_time: $("s-start").value,
        end_time: $("s-end").value,
        grace_minutes: $("s-grace").value,
        break_minutes: $("s-break").value,
        break_after_minutes: $("s-break-after").value,
        workdays,
      }),
    });
    $("shift-form").reset();
    banner("Shift added. Assign people to it when you add or edit them.", "ok");
    await loadPeople();
  } catch (error) {
    banner(error.message || "Could not add that shift.", "bad");
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

