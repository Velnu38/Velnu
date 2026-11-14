// This small, independent script stays available when the app bundle cannot load.
// Retry a download only before React opens. Never interrupt an open workspace.
(function () {
  var panel = document.getElementById('startup-recovery');
  var message = document.getElementById('startup-recovery-message');
  var dismiss = document.getElementById('startup-dismiss');
  var diagnostic = document.getElementById('startup-diagnostic');
  var mounted = false;
  var failure = 'The app did not finish opening.';
  var retryQueued = false;
  var retryTimer = null;
  var terminalFailure = false;
  var initialUrl = new URL(window.location.href);
  var alreadyRetried = initialUrl.searchParams.has('fv_boot_retry');
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
    var detail = event && (event.detail || event.payload || event.error || event);
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
    var entry = document.querySelector('script[type="module"][src]');
    var entryUrl = entry ? new URL(entry.src, window.location.href) : null;
    var source = event && event.target;
    var resourceUrl = source && source.tagName === 'SCRIPT' ? new URL(source.src, window.location.href) : null;
    var downloadFailure = detail && typeof detail.message === 'string' &&
      /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|unable to preload css/i.test(detail.message);
    if (description && !downloadFailure) {
      terminalFailure = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      retryTimer = null;
    }
    var retryable = !event || downloadFailure ||
      (resourceUrl && resourceUrl.origin === window.location.origin && /^\/assets\/[\w.-]+\.js$/.test(resourceUrl.pathname));
    // The static placeholder must still exist: even an early React render may
    // expose a form before its mounted effect has fired. The URL marker works
    // when browser storage is blocked and survives the one navigation.
    if (!mounted && !alreadyRetried && !retryQueued && !terminalFailure && retryable &&
      window.navigator.onLine !== false && document.querySelector('#root #startup-loading') &&
      entryUrl && entryUrl.origin === window.location.origin && /^\/assets\/[\w.-]+\.js$/.test(entryUrl.pathname)) {
      retryQueued = true;
      window.clearTimeout(timer);
      message.textContent = 'Reopening Finviant once to load the current version…';
      retryTimer = window.setTimeout(function () {
        retryTimer = null;
        if (mounted || !document.querySelector('#root #startup-loading')) return;
        if (window.navigator.onLine === false) {
          message.textContent = 'You appear to be offline. Reconnect, then reload Finviant.';
          return;
        }
        var fresh = new URL(window.location.href);
        fresh.searchParams.set('fv_boot_retry', '1');
        fresh.searchParams.set('startup_retry', String(Date.now()));
        window.location.replace(fresh.href);
      }, 500);
    }
  }

  var timer = window.setTimeout(showRecovery, 15000);
  window.addEventListener('finviant:app-mounted', function () {
    mounted = true;
    window.clearTimeout(timer);
    if (retryTimer !== null) window.clearTimeout(retryTimer);
    panel.hidden = true;
    // Successful startup ends the retry cycle without changing account data or
    // document links. A later explicit visit can recover independently.
    try {
      var clean = new URL(window.location.href);
      if (clean.searchParams.has('fv_boot_retry') || clean.searchParams.has('startup_retry')) {
        clean.searchParams.delete('fv_boot_retry');
        clean.searchParams.delete('startup_retry');
        window.history.replaceState(window.history.state, '', clean.href);
      }
    } catch (_) { /* History access must never stop a healthy workspace. */ }
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
    fresh.searchParams.delete('fv_boot_retry');
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
