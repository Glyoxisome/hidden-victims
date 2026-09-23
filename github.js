/**
 * github.js — shared direct-to-GitHub read/write helpers.
 *
 * Every call here goes straight from the browser to api.github.com using the
 * logged-in user's own token (from Auth.getToken()). No Worker is involved -
 * this keeps every edit off Cloudflare's request count entirely.
 *
 * GitHub itself enforces who can actually write (a removed collaborator's
 * token will get a 403/404 from the PUT call below) - that enforcement is
 * automatic and does not need anything from this file.
 */

var GitHubEditor = (function () {
  "use strict";

  // CHANGE THESE to your actual repo.
  var OWNER = "Glyoxisome";
  var REPO = "hidden-victims";
  var BRANCH = "main";

  function apiHeaders() {
    return {
      Authorization: "Bearer " + Auth.getToken(),
      Accept: "application/vnd.github+json",
    };
  }

  // Fetch a file's raw text content plus its current sha (sha is required by
  // GitHub's API to update the file - it's how GitHub prevents accidentally
  // overwriting someone else's more recent edit).
  function getFile(path) {
    var url =
      "https://api.github.com/repos/" +
      OWNER +
      "/" +
      REPO +
      "/contents/" +
      path +
      "?ref=" +
      BRANCH;

    return fetch(url, { headers: apiHeaders(), cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("Could not load " + path + " (HTTP " + res.status + ")");
        return res.json();
      })
      .then(function (data) {
        // content comes back base64-encoded
        var text = decodeURIComponent(
          atob(data.content.replace(/\n/g, ""))
            .split("")
            .map(function (c) {
              return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2);
            })
            .join("")
        );
        return { text: text, sha: data.sha };
      });
  }

  // Commit new content for an existing file. Throws a clear error on
  // permission failure (removed collaborator) or a stale sha (someone else
  // edited the file since we last fetched it) so calling code can show a
  // sensible message instead of silently failing.
  function updateFile(path, newText, sha, commitMessage) {
    var url =
      "https://api.github.com/repos/" + OWNER + "/" + REPO + "/contents/" + path;

    var encodedContent = btoa(
      encodeURIComponent(newText).replace(/%([0-9A-F]{2})/g, function (_, hex) {
        return String.fromCharCode(parseInt(hex, 16));
      })
    );

    return fetch(url, {
      method: "PUT",
      headers: Object.assign(apiHeaders(), { "Content-Type": "application/json" }),
      body: JSON.stringify({
        message: commitMessage || "Update " + path,
        content: encodedContent,
        sha: sha,
        branch: BRANCH,
      }),
    }).then(function (res) {
      if (res.status === 409) {
        throw new Error(
          "This file changed since you loaded it (someone else may have edited it). Please reload and try again."
        );
      }
      if (res.status === 403 || res.status === 404) {
        throw new Error(
          "You don't have permission to save changes to this repository right now."
        );
      }
      if (!res.ok) {
        return res.json().then(function (err) {
          throw new Error(err.message || "GitHub rejected the update (HTTP " + res.status + ")");
        });
      }
      return res.json();
    });
  }

  return {
    getFile: getFile,
    updateFile: updateFile,
  };
})();
