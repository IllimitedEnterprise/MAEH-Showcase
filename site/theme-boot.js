/* Runs before the first paint so a remembered light theme never flashes dark. Classic script on
 * purpose: the module graph loads later. Storage may be blocked; then the house dark theme stays. */
(function () {
  try {
    var stored = window.localStorage.getItem("maeh-showcase-theme");
    if (stored === "light" || stored === "dark") document.documentElement.setAttribute("data-theme", stored);
  } catch (error) {
    /* keep the default */
  }
})();
