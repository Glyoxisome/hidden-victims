/**
 * auth.js — shared by every page that wants edit capability.
 *
 * Responsibilities:
 *   - Point the "Login" button at the Worker's /auth/login
 *   - On page load, pick up the token the Worker sent back (in the URL fragment)
 *     and stash it in sessionStorage so it survives navigation within the tab
 *     but disappears when the tab/browser closes
 *   - Provide isLoggedIn() / getToken() / logout() for other scripts to use
 *
 * Include this on every editable page, before github-editor.js.
 */

var Auth = (function () {
  "use strict";

  // CHANGE THIS to your deployed Worker's URL.
  var WORKER_URL = "https://auth-worker.evidence.workers.dev";

  var STORAGE_KEY = "gh_token";

  function captureTokenFromUrl() {
    if (location.hash && location.hash.indexOf("gh_token=") !== -1) {
      var match = location.hash.match(/gh_token=([^&]+)/);
      if (match) {
        var token = decodeURIComponent(match[1]);
        sessionStorage.setItem(STORAGE_KEY, token);
        // Remove the token from the visible URL so it's not sitting in
        // browser history / accidentally shared via copy-paste of the URL.
        history.replaceState(null, "", location.pathname + location.search);
      }
    }
  }

  function isLoggedIn() {
    return !!sessionStorage.getItem(STORAGE_KEY);
  }

  function getToken() {
    return sessionStorage.getItem(STORAGE_KEY);
  }

  function login() {
    location.href = WORKER_URL + "/auth/login";
  }

  function logout() {
    sessionStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem("gh_username");
    location.reload();
  }

  // Fetch and cache the username once per session (used for commit messages
  // and optionally for deciding whether to show pencils at all).
  function getUsername() {
    var cached = sessionStorage.getItem("gh_username");
    if (cached) return Promise.resolve(cached);
    if (!isLoggedIn()) return Promise.resolve(null);

    return fetch("https://api.github.com/user", {
      headers: { Authorization: "Bearer " + getToken() },
    })
      .then(function (res) {
        if (!res.ok) throw new Error("Could not verify GitHub identity");
        return res.json();
      })
      .then(function (data) {
        sessionStorage.setItem("gh_username", data.login);
        return data.login;
      });
  }

  captureTokenFromUrl();

  return {
    isLoggedIn: isLoggedIn,
    getToken: getToken,
    login: login,
    logout: logout,
    getUsername: getUsername,
  };
})();
