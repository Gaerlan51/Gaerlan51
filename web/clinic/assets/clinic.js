/* Clinic prototype — the only behaviour on these pages.

   Four small things, each guarded so one page can load this file and use none
   of it: the password reveal, the booking screen's two request paths, the
   message queue's preview, and the enquiry composer.

   The sign-in form never reads the password field and says so on the page. The
   enquiry form sends only once a real endpoint is filled in, and says which of
   the two it is doing — because a form that looks like it works and doesn't is
   worse than one that admits it. */
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

  /* --- enquiry form ------------------------------------------------------- */
  /* Two modes, decided by whether the form's action is still a placeholder.

     Unconfigured: the form composes a labelled block the visitor copies and
     sends themselves, and says plainly that it does not send. Configured with
     a relay endpoint (Formspree, Web3Forms, Getform — anything that accepts a
     POSTed FormData and emails it on): it posts and confirms inline.

     A failed post falls back to the copy block rather than losing what they
     typed. Nothing here books an appointment — it puts a request in front of a
     person, which is the whole design. */
  var form = document.getElementById("enquiry");
  var readout = document.getElementById("readout");
  if (form && readout) {
    var block = document.getElementById("readout-text");
    var copy = document.getElementById("copy");
    var lead = document.getElementById("readout-lead");
    var action = form.getAttribute("action") || "";
    var configured = action && action.indexOf("[") === -1;
    var LABELS = [
      ["name", "Name"],
      ["mobile", "Mobile"],
      ["city", "Clinic"],
      ["service", "For"],
      ["when", "Preferred"],
      ["note", "Notes"]
    ];

    function compose(data) {
      return LABELS.map(function (pair) {
        var value = (data.get(pair[0]) || "").toString().trim();
        return value ? pair[1] + ": " + value : null;
      }).filter(Boolean).join("\n");
    }

    function show(leadText, bodyText, showCopy) {
      if (lead) lead.textContent = leadText;
      block.textContent = bodyText;
      block.hidden = !bodyText;
      if (copy) copy.hidden = !showCopy;
      readout.hidden = false;
      readout.scrollIntoView({ block: "nearest" });
    }

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var data = new FormData(form);

      if ((data.get("website") || "").toString()) return;   // honeypot

      var name = (data.get("name") || "").toString().trim();
      var mobile = (data.get("mobile") || "").toString().trim();
      if (!name || !mobile) {
        show("We need a name and a mobile number to reply to.", "", false);
        return;
      }

      var text = compose(data);

      if (!configured) {
        show("This form does not send yet. Copy the block below and send it to the clinic \u2014 the labels are the ones the front desk expects.", text, true);
        return;
      }

      var button = form.querySelector('button[type="submit"]');
      if (button) { button.disabled = true; button.textContent = "Sending\u2026"; }

      fetch(action, { method: "POST", body: data, headers: { Accept: "application/json" } })
        .then(function (response) {
          if (!response.ok) throw new Error(response.status);
          form.reset();
          show("Salamat po \u2014 your request is with the front desk. You will get a reply with open slots and the city for that week. Nothing is booked until you confirm.", "", false);
        })
        .catch(function () {
          show("That did not send \u2014 sorry po. Copy the block below and send it to the clinic instead, and nothing you typed is lost.", text, true);
        })
        .then(function () {
          if (button) { button.disabled = false; button.textContent = "Send my request"; }
        });
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
