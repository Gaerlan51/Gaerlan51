/* Fills the poster from the API. Requires a dashboard session, like every
 * other admin route — a poster names a workplace and its code, so it is not
 * something to serve to the open internet. */

const params = new URLSearchParams(location.search);
const wanted = params.get("location");

function fail(message) {
  const banner = document.getElementById("banner");
  banner.textContent = message;
  banner.classList.remove("hidden");
}

async function load() {
  let response;
  try {
    response = await fetch("/api/admin/locations", {
      credentials: "same-origin",
      headers: { "X-Requested-With": "dtr" },
    });
  } catch (err) {
    fail("Could not reach the server.");
    return;
  }
  if (response.status === 401 || response.status === 403) {
    fail("Sign in to the dashboard first, then open this poster again.");
    return;
  }
  const locations = await response.json();
  const location = locations.find((row) => String(row.id) === wanted) || locations[0];
  if (!location) {
    fail("No location to print yet. Add one on the dashboard first.");
    return;
  }

  const config = await fetch("/api/config", { credentials: "same-origin" })
    .then((r) => r.json()).catch(() => ({}));

  document.getElementById("org").textContent = config.organisation || "Time Record";
  document.getElementById("place").textContent = location.name;
  document.getElementById("code").textContent = location.code;
  const qr = document.getElementById("qr");
  qr.src = `/api/admin/locations/${location.id}/qr.svg`;
  qr.alt = `QR code for ${location.name}. If it will not scan, type the code ${location.code}.`;
  document.title = `Clock-in poster — ${location.name}`;
  document.getElementById("sheet").hidden = false;
}

document.getElementById("print").addEventListener("click", () => window.print());
load();
