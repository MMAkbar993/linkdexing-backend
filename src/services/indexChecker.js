const axios = require("axios");

const BASE_URL = "https://app.indexchecker.link/api";

// IndexChecker.link's own quirk, confirmed by testing against the real API:
// every response is HTTP 200, success or failure. Failure is signalled by
// `error: 1` in the JSON body, with a message that isn't reliably in
// English (an invalid key returned a Polish string). So: check `error`,
// never the HTTP status, and never surface their `message` to a user -
// write our own.
async function call(path, params) {
  const body = new URLSearchParams({
    apikey: process.env.INDEXCHECKER_API_KEY,
    ...params,
  });
  const { data } = await axios.post(`${BASE_URL}${path}`, body.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  if (data.error) {
    const err = new Error(`IndexChecker.link API error at ${path}`);
    err.indexCheckerResponse = data;
    throw err;
  }

  return data;
}

// Submits a batch of URLs as one project. Their API takes the whole list in
// a single call (pipe-separated) and processes it on their side - no
// chunking needed on ours, even for a few hundred URLs.
async function createProject(projectName, urls) {
  const data = await call("/project/create", {
    project_name: projectName,
    urls: urls.join("|"),
  });
  return { projectId: String(data.project_id) };
}

// Poll this until statistics.pending === 0. Status per URL: 1 = indexed,
// 0 = not indexed, -1 = still checking.
async function getProject(projectId) {
  const data = await call("/project/show", { project_id: projectId });
  return {
    urls: data.urls, // { [url]: 1 | 0 | -1 }
    statistics: data.statistics, // { total_links, indexed, not_indexed, pending, percentage }
  };
}

async function deleteProject(projectId) {
  await call("/project/delete", { project_id: projectId });
}

// Their remaining check quota - not the same thing as our own users' credit
// balances. Useful for an admin sanity check, not exposed to end users.
async function checkBalance() {
  const data = await call("/check-balance", {});
  return data.limit;
}

module.exports = { createProject, getProject, deleteProject, checkBalance };
