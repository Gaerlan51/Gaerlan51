/* Clinic prototype — the only behaviour on these pages.

   Four small things, each guarded so one page can load this file and use none
   of it: the password reveal, the booking screen's two request paths, the
   message queue's preview, and the enquiry composer.

   Nothing here sends anything anywhere. The enquiry form composes a block the
   visitor copies; the sign-in form never reads the password field. Both say so
   on the page rather than in a comment, because a form that looks like it works
   and doesn't is worse than one that admits it. */
(function () {
  "use strict";

  /* --- password reveal ---------------------------------------------------- */
  var pw = document.querySelector("[data-pw-toggle]");
  if (pw) {
    var input = document.getElementById(pw.getAttribute("data-pw-toggle"));
    pw.addEventListener("click", function () {
      var shown = input.type === "text";
      input.type = shown ? "password" : "text";
      pw.setAttribute("aria-label", shown ? "Show password" : "Hide password");
      pw.querySelector("[data-icon-show]").hidden = !shown;
      pw.querySelector("[data-icon-hide]").hidden = shown;
      input.focus();
    });
  }

  /* --- generic single-select group ---------------------------------------- */
  /* Every picker on these screens is the same widget: buttons in a group, one
     selected, optional panels revealed by name. */
  function group(root, attr, onPick) {
    var buttons = Array.prototype.slice.call(root.querySelectorAll("[" + attr + "]"));
    if (!buttons.length) return;

    function select(value) {
      buttons.forEach(function (b) {
        var on = b.getAttribute(attr) === value;
        b.setAttribute(b.hasAttribute("role") ? "aria-selected" : "aria-pressed", on ? "true" : "false");
      });
      if (onPick) onPick(value);
    }

    buttons.forEach(function (b) {
      b.addEventListener("click", function () { select(b.getAttribute(attr)); });
    });

    var initial = root.querySelector("[" + attr + "][aria-selected='true'], [" + attr + "][aria-pressed='true']");
    select(initial ? initial.getAttribute(attr) : buttons[0].getAttribute(attr));
  }

  function showOnly(name, value) {
    Array.prototype.forEach.call(document.querySelectorAll("[data-" + name + "]"), function (el) {
      el.hidden = el.getAttribute("data-" + name) !== value;
    });
  }

  /* --- bookings: the routine path and the escalated one ------------------- */
  var requests = document.querySelector("[data-requests]");
  if (requests) {
    group(requests, "data-request", function (value) { showOnly("request-panel", value); });
  }

  var slots = document.querySelector("[data-slots]");
  if (slots) {
    var chosen = document.getElementById("chosen-slot");
    group(slots, "data-slot", function (value) {
      var btn = slots.querySelector("[data-slot='" + value + "']");
      if (chosen && btn) chosen.textContent = btn.getAttribute("data-summary");
    });
  }

  /* --- messages: queue row picks the preview ------------------------------ */
  var queue = document.querySelector("[data-queue]");
  if (queue) {
    group(queue, "data-message", function (value) { showOnly("message-panel", value); });
  }

  /* --- enquiry composer --------------------------------------------------- */
  var form = document.getElementById("enquiry");
  var readout = document.getElementById("readout");
  if (form && readout) {
    var block = document.getElementById("readout-text");
    var copy = document.getElementById("copy");
    var LABELS = [
      ["name", "Name"],
      ["mobile", "Mobile"],
      ["service", "For"],
      ["when", "Preferred"],
      ["note", "Notes"]
    ];

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var data = new FormData(form);
      var lines = LABELS.map(function (pair) {
        var value = (data.get(pair[0]) || "").toString().trim();
        return value ? pair[1] + ": " + value : null;
      }).filter(Boolean);

      block.textContent = lines.length
        ? lines.join("\n")
        : "Fill in at least your name and mobile number, then press the button again.";
      readout.hidden = false;
      readout.scrollIntoView({ block: "nearest" });
    });

    if (copy) {
      copy.addEventListener("click", function () {
        if (!navigator.clipboard) return;
        navigator.clipboard.writeText(block.textContent).then(function () {
          copy.textContent = "Copied";
          setTimeout(function () { copy.textContent = "Copy"; }, 2000);
        });
      });
    }
  }
})();
