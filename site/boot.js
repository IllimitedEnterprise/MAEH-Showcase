/* Starts the app, and heals the one failure a page made of many small scripts is prone to: a static
 * host answering a single file with a 503 or a dropped connection, which would leave the page blank.
 * A failed script is remembered by the browser for the life of the page, so the only retry that works is
 * a fresh load: reload up to twice, then say plainly what happened. Classic script on purpose, so it runs
 * even when the module graph cannot. */
(function () {
  var KEY = "maeh-showcase-boot-tries";
  var entry = document.currentScript && document.currentScript.getAttribute("data-entry");

  function tries() {
    try {
      return Number(window.sessionStorage.getItem(KEY) || 0);
    } catch (error) {
      return -1; /* storage blocked: no automatic reloads, so there can be no reload loop */
    }
  }

  function remember(count) {
    try {
      window.sessionStorage.setItem(KEY, String(count));
    } catch (error) {
      /* nothing to do */
    }
  }

  function giveUp() {
    var view = document.getElementById("view");
    if (!view) return;
    view.textContent = "";
    var message = document.createElement("p");
    message.className = "loading";
    message.textContent = "The page could not load its scripts. This is usually a brief hiccup on the host; reloading normally fixes it.";
    var button = document.createElement("button");
    button.type = "button";
    button.className = "btn";
    button.textContent = "Reload";
    button.addEventListener("click", function () {
      remember(0);
      window.location.reload();
    });
    var wrap = document.createElement("p");
    wrap.className = "loading";
    wrap.appendChild(button);
    view.appendChild(message);
    view.appendChild(wrap);
  }

  if (!entry) return;
  import(entry).then(
    function () {
      remember(0);
    },
    function () {
      var count = tries();
      if (count >= 0 && count < 2) {
        remember(count + 1);
        window.setTimeout(function () {
          window.location.reload();
        }, 700 * (count + 1));
        return;
      }
      giveUp();
    }
  );
})();
