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

  /* --- the rotation ------------------------------------------------------- */
  /* The clinic alternates whole weeks between two cities, so every page that
     claims to know what "this week" is has to work it out rather than carry a
     date someone typed. One anchor drives all of it: a Monday known to be a
     Las Pinas week. Parity from there gives every other week, forwards and
     back, and the pages fill themselves from data attributes.

     This assumes the alternation never breaks. Close for a holiday, or sit two
     weeks in one city, and the parity is wrong from that point on — move the
     anchor to the first Monday of the new pattern and it is right again. */
  var ANCHOR = { y: 2026, m: 8, d: 7 };            // Mon 7 Sep 2026, Las Pinas
  var CITIES = ["Las Pi\u00f1as", "Cagayan de Oro"];
  var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July",
                "August", "September", "October", "November", "December"];
  var SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function mondayOf(date) {
    var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d;
  }

  function addWeeks(monday, n) {
    var d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate());
    d.setDate(d.getDate() + n * 7);
    return d;
  }

  /* Date-only UTC arithmetic, so a daylight-saving boundary can never shift a
     week by one and flip every city on the page. */
  function weekIndex(monday) {
    var a = Date.UTC(ANCHOR.y, ANCHOR.m, ANCHOR.d);
    var m = Date.UTC(monday.getFullYear(), monday.getMonth(), monday.getDate());
    return Math.round((m - a) / 604800000);
  }

  function cityOf(monday) {
    return CITIES[((weekIndex(monday) % 2) + 2) % 2];
  }

  function rangeOf(monday) {
    var sat = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 5);
    var tail = "Sat " + sat.getDate() + " " + SHORT[sat.getMonth()];
    return monday.getMonth() === sat.getMonth()
      ? "Mon " + monday.getDate() + " – " + tail
      : "Mon " + monday.getDate() + " " + SHORT[monday.getMonth()] + " – " + tail;
  }

  function fill(selector, text) {
    Array.prototype.forEach.call(document.querySelectorAll(selector), function (el) {
      el.textContent = text;
    });
  }

  (function rotation() {
    var now = new Date();
    var thisWeek = mondayOf(now);
    var nextWeek = addWeeks(thisWeek, 1);

    fill("[data-rota-city='now']", cityOf(thisWeek));
    fill("[data-rota-when='now']", rangeOf(thisWeek));
    fill("[data-rota-city='next']", cityOf(nextWeek));
    fill("[data-rota-when='next']", rangeOf(nextWeek));
    fill("[data-rota-heading]", "This week in " + cityOf(thisWeek));
    fill("[data-rota-next-label]", "Next week · " + cityOf(nextWeek));
    fill("[data-today-line]",
      DAYS[now.getDay()] + ", " + now.getDate() + " " + MONTHS[now.getMonth()]
      + " · " + cityOf(thisWeek) + " week · clinic opens 09:00");

    // the marketing day card: the coming Thursday, in whichever city that is
    var thursday = new Date(thisWeek.getFullYear(), thisWeek.getMonth(), thisWeek.getDate() + 3);
    if (thursday < now) thursday = new Date(thursday.getFullYear(), thursday.getMonth(), thursday.getDate() + 7);
    fill("[data-hero-day]", DAYS[thursday.getDay()] + ", " + thursday.getDate() + " " + MONTHS[thursday.getMonth()]);
    fill("[data-hero-city]", cityOf(mondayOf(thursday)) + " · 2 left");

    var list = document.querySelector("[data-weeks]");
    if (list) {
      list.textContent = "";
      for (var i = 0; i < 6; i++) {
        var monday = addWeeks(thisWeek, i);
        var city = cityOf(monday);
        var card = document.createElement("div");
        card.className = "week" + (i === 0 ? " week--now" : "")
          + (city === CITIES[1] ? " week--cdo" : "");
        var when = document.createElement("div");
        when.className = "week__k";
        when.textContent = rangeOf(monday);
        var where = document.createElement("div");
        where.className = "week__c";
        where.textContent = city;
        card.appendChild(when);
        card.appendChild(where);
        list.appendChild(card);
      }
    }
  })();

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
