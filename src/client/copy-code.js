/*
 * Copy code: copies a snippet to the clipboard from the button in a code block's header.
 * Emitted by the `code` component via ctx.useScript("copy-code").
 *
 *   [data-copy-code="<id>"]   <button> that copies the text content of #<id>.
 *
 * The button is progressive enhancement: the snippet is plain selectable text without it, and
 * the script is a no-op when no hooks are present. Uses the async Clipboard API where available
 * (secure contexts only) and falls back to selecting the snippet so the visitor can copy it.
 */
(function copyCode() {
  document.addEventListener("click", function (event) {
    var button = event.target.closest("[data-copy-code]");
    if (!button) return;
    var code = document.getElementById(button.getAttribute("data-copy-code"));
    if (!code) return;

    var done = function (ok) {
      button.textContent = ok ? "Copied" : "Press \u2318C";
      button.setAttribute("data-copied", "");
      setTimeout(function () {
        button.textContent = "Copy";
        button.removeAttribute("data-copied");
      }, 2000);
    };

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(code.textContent).then(
        function () { done(true); },
        function () { done(false); },
      );
      return;
    }

    var range = document.createRange();
    range.selectNodeContents(code);
    var selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    done(false);
  });
})();
