import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
export async function publishReport({
  fetcher = fetch,
  token,
  repository,
  branch,
  expectedSha,
  content,
}) {
  if (
    repository !== "Velnu38/Velnu" ||
    branch !== "ux/private-testing-20261029" ||
    !/^[a-f0-9]{40}$/.test(expectedSha || "") ||
    !token
  )
    throw Error("Trusted assessment publication context required");
  const base = "https://api.github.com/repos/" + repository,
    headers = {
      authorization: "Bearer " + token,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
  async function api(path, body) {
    const response = await fetcher(base + path, {
      method: body ? (path.startsWith("/git/refs/") ? "PATCH" : "POST") : "GET",
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok)
      throw Error("Assessment publication refused: HTTP " + response.status);
    return response.json();
  }
  const ref = await api("/git/ref/heads/" + branch);
  if (ref.object.sha !== expectedSha)
    return {
      updated: false,
      reason: "Branch advanced; a newer push must regenerate the report.",
    };
  const current = await api(
    "/contents/ASSESSMENT_REPORT.md?ref=" + expectedSha,
  );
  if (
    Buffer.from(current.content.replace(/\s/g, ""), "base64").toString(
      "utf8",
    ) === content
  )
    return { updated: false, reason: "Report already current." };
  const parent = await api("/git/commits/" + expectedSha),
    tree = await api("/git/trees", {
      base_tree: parent.tree.sha,
      tree: [
        { path: "ASSESSMENT_REPORT.md", mode: "100644", type: "blob", content },
      ],
    }),
    commit = await api("/git/commits", {
      message: "Refresh Finviant readiness report [skip ci]",
      tree: tree.sha,
      parents: [expectedSha],
    });
  await api("/git/refs/heads/" + branch, { sha: commit.sha, force: false });
  return { updated: true, sha: commit.sha };
}
if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const result = await publishReport({
    token: process.env.GITHUB_TOKEN,
    repository: process.env.GITHUB_REPOSITORY,
    branch: process.env.GITHUB_REF_NAME,
    expectedSha: process.env.GITHUB_SHA,
    content: readFileSync("ASSESSMENT_REPORT.md", "utf8"),
  });
  console.log(
    result.updated ? "Published a report-only update." : result.reason,
  );
}
