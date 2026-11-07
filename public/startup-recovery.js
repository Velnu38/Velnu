// This small, independent script stays available when the app bundle cannot load.
// Never reload automatically: an open workspace may contain unsaved edits.
(function () {
  var panel = document.getElementById('startup-recovery');
  var message = document.getElementById('startup-recovery-message');
  var dismiss = document.getElementById('startup-dismiss');
  var diagnostic = document.getElementById('startup-diagnostic');
  var mounted = false;
  var failure = 'The app did not finish opening.';
  if (!panel || !message || !dismiss) return;

  function safeError(error) {
    if (!error || typeof error.message !== 'string') return '';
    // Display useful browser failure text locally, never URLs, credentials,
    // email addresses, stacks, or account details. Nothing is uploaded.
    return ((typeof error.name === 'string' ? error.name + ': ' : '') + error.message)
      .replace(/https?:\/\/[^\s'"<>]+/gi, '[resource]')
      .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[email]')
      .replace(/\b(?:sb_(?:secret|publishable)_[\w-]+|sk-[\w-]+|re_[\w-]+)\b/g, '[redacted]')
      .replace(/[a-z0-9_-]{24,}/gi, '[redacted]')
      .slice(0, 280);
  }

  function showRecovery(event) {
    var detail = event && (event.detail || event.payload || event.error);
    var description = safeError(detail);
    if (description) failure = description;
    message.textContent = mounted
      ? 'A page couldn’t load. Save any open edits before reloading Finviant.'
      : 'Check your connection, then reload Finviant.';
    if (diagnostic) {
      diagnostic.textContent = 'Loading check: ' + failure;
      diagnostic.hidden = false;
    }
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
      if (script && script.tagName === 'SCRIPT') failure = 'The app entry script could not be loaded.';
      showRecovery(event);
    }
  }, true);
  document.getElementById('startup-reload').addEventListener('click', function () {
    var fresh = new URL(window.location.href);
    fresh.searchParams.set('startup_retry', String(Date.now()));
    window.location.replace(fresh.href);
  });
  var check = document.getElementById('startup-check');
  if (check) check.addEventListener('click', function () {
    if (!window.fetch || !diagnostic) return;
    var paths = [];
    var resources = document.querySelectorAll('script[src], link[rel="modulepreload"], link[rel="stylesheet"]');
    for (var i = 0; i < resources.length; i++) {
      var resource = new URL(resources[i].src || resources[i].href, window.location.href);
      if (resource.origin === window.location.origin && /^\/assets\/[\w.-]+\.(js|css)$/.test(resource.pathname) && paths.indexOf(resource.pathname) === -1) paths.push(resource.pathname);
    }
    check.disabled = true;
    diagnostic.hidden = false;
    diagnostic.textContent = 'Loading check: ' + failure + '\nChecking app files…';
    Promise.all(paths.slice(0, 10).map(function (path) {
      var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timeout = controller ? window.setTimeout(function () { controller.abort(); }, 8000) : null;
      return window.fetch(path + '?fv_load_check=' + Date.now(), {
        method: 'HEAD', cache: 'no-store', redirect: 'manual', credentials: 'same-origin',
        signal: controller ? controller.signal : undefined
      }).then(function (response) {
        var type = response.headers.get('content-type') || '';
        var status = 'OK';
        if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) status = 'ACCESS_REQUIRED';
        else if (response.status === 401 || response.status === 403) status = 'ACCESS_DENIED';
        else if (response.status === 404) status = 'MISSING_FILE';
        else if (!response.ok) status = 'HTTP_' + response.status;
        else if (!(/\.css$/.test(path) ? /text\/css/i : /javascript|ecmascript/i).test(type)) status = 'WRONG_FILE_TYPE';
        return path.split('/').pop() + ': ' + status;
      }).catch(function () { return path.split('/').pop() + ': NETWORK_ERROR'; })
        .finally(function () { if (timeout !== null) window.clearTimeout(timeout); });
    })).then(function (results) {
      diagnostic.textContent = 'Loading check: ' + failure + '\n' + (results.length ? results.join('\n') : 'No app files were found in this page.');
      check.disabled = false;
    });
  });
  dismiss.addEventListener('click', function () { panel.hidden = true; });
})();
