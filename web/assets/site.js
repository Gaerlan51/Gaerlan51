/* Intake composer.
   The form submits nowhere: it builds a labelled block the visitor copies and
   sends themselves. Those labels are the ones `ops add --from-intake` parses,
   so an enquiry pasted into Messenger goes into the tracker without retyping.

   To make this actually post somewhere, give the <form id="intake"> an action
   and a handler — nothing else here assumes a backend. */
(function () {
  "use strict";

  var form = document.getElementById("intake");
  var readout = document.getElementById("readout");
  var state = document.getElementById("readout-state");
  var copy = document.getElementById("copy");
  if (!form || !readout) return;

  var LABELS = [
    ["name", "Name"],
    ["school", "School"],
    ["topic", "Thesis title"],
    ["stage", "Stage"],
    ["service", "Service"],
    ["deadline", "Deadline"],
    ["notes", "Notes"]
  ];
  var touched = false;

  function compose() {
    var data = new FormData(form);
    var lines = [];
    LABELS.forEach(function (pair) {
      var value = (data.get(pair[0]) || "").toString().trim();
      if (value) lines.push(pair[1] + ": " + value);
    });
    return lines.join("\n");
  }

  function refresh() {
    var text = compose();
    // Selects carry defaults, so "touched" is the honest test for real input.
    if (!touched) return;
    readout.textContent = text || "Your enquiry will appear here as you fill the form.";
    state.textContent = "Your enquiry";
  }

  form.addEventListener("input", function () { touched = true; refresh(); });
  form.addEventListener("change", function () { touched = true; refresh(); });
  form.addEventListener("submit", function (event) { event.preventDefault(); });

  if (copy) {
    copy.addEventListener("click", function () {
      var text = touched ? compose() : readout.textContent;
      var done = function (ok) {
        copy.textContent = ok ? "Copied" : "Select and copy";
        window.setTimeout(function () { copy.textContent = "Copy"; }, 2200);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
      } else {
        var range = document.createRange();
        range.selectNodeContents(readout);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        done(false);
      }
    });
  }
})();
