// This small, independent script stays available when the app bundle cannot load.
// Never reload automatically: an open workspace may contain unsaved edits.
(function () {
  var panel = document.getElementById('startup-recovery');
  var message = document.getElementById('startup-recovery-message');
  var dismiss = document.getElementById('startup-dismiss');
  var mounted = false;
  if (!panel || !message || !dismiss) return;

  function showRecovery() {
    var loading = document.getElementById('startup-loading');
    if (loading) loading.hidden = true;
    message.textContent = mounted
      ? 'A page couldn’t load. Save any open edits before reloading Finviant.'
      : 'Check your connection, then reload Finviant.';
    dismiss.hidden = !mounted;
    panel.hidden = false;
  }

  var timer = window.setTimeout(showRecovery, 15000);
  window.addEventListener('finviant:app-mounted', function () {
    mounted = true;
    window.clearTimeout(timer);
    panel.hidden = true;
  }, { once: true });
  window.addEventListener('finviant:startup-error', showRecovery);
  window.addEventListener('vite:preloadError', showRecovery);
  window.addEventListener('error', function (event) {
    // Resource errors do not bubble. Capture the entry script failing to load,
    // and same-origin module evaluation errors before React can render.
    var script = event.target;
    if (!mounted && ((script && script.tagName === 'SCRIPT') ||
      (event.filename && event.filename.indexOf(window.location.origin + '/') === 0))) {
      showRecovery();
    }
  }, true);
  document.getElementById('startup-reload').addEventListener('click', function () {
    window.location.reload();
  });
  dismiss.addEventListener('click', function () { panel.hidden = true; });
})();
