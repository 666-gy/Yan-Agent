import { execFile, execFileSync } from "child_process";
const GIT_TIMEOUT_MS = 5e3;
const GIT_MAX_BUFFER_BYTES = 4 * 1024 * 1024;
const PROJECT_PATHSPEC = [
  "--",
  ".",
  ":(exclude).understand-anything",
  ":(exclude).understand-anything/**",
  ":(exclude).ua",
  ":(exclude).ua/**"
];
class GitCommandError extends Error {
  constructor(exitCode, timedOut) {
    super(timedOut ? "Git command timed out" : "Git command failed");
    this.exitCode = exitCode;
    this.timedOut = timedOut;
  }
}
function runGit(projectDir, args) {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      {
        cwd: projectDir,
        encoding: null,
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: GIT_MAX_BUFFER_BYTES,
        windowsHide: true
      },
      (error, stdout) => {
        if (error) {
          reject(
            new GitCommandError(
              typeof error.code === "number" ? error.code : null,
              error.killed === true && error.signal !== null
            )
          );
          return;
        }
        resolve(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout));
      }
    );
  });
}
function parseScalar(output) {
  return output.toString("utf8").trim();
}
function parseNulDelimitedPaths(output) {
  const value = output.toString("utf8");
  if (value.length === 0) return [];
  const paths = value.split("\0");
  if (paths.at(-1) === "") paths.pop();
  return paths.filter((path) => path.length > 0);
}
function uniqueSortedPaths(...pathGroups) {
  return [...new Set(pathGroups.flat())].sort();
}
function optionalAnalysisTime(input) {
  return input.lastAnalyzedAt === void 0 ? {} : { lastAnalyzedAt: input.lastAnalyzedAt };
}
function unknownReason(error, fallback) {
  return error instanceof GitCommandError && error.timedOut ? "git-command-timeout" : fallback;
}
async function createProjectGitSnapshot(projectDir) {
  const repoRoot = parseScalar(
    await runGit(projectDir, ["rev-parse", "--show-toplevel"])
  );
  const headCommitHash = parseScalar(
    await runGit(projectDir, ["rev-parse", "HEAD"])
  );
  const [staged, unstaged, untracked] = await Promise.all([
    runGit(projectDir, [
      "diff",
      "--cached",
      "--name-only",
      "-z",
      "--relative",
      ...PROJECT_PATHSPEC
    ]),
    runGit(projectDir, [
      "diff",
      "--name-only",
      "-z",
      "--relative",
      ...PROJECT_PATHSPEC
    ]),
    runGit(projectDir, [
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
      ...PROJECT_PATHSPEC
    ])
  ]);
  return {
    projectDir,
    repoRoot,
    headCommitHash,
    dirtyFiles: uniqueSortedPaths(
      parseNulDelimitedPaths(staged),
      parseNulDelimitedPaths(unstaged),
      parseNulDelimitedPaths(untracked)
    )
  };
}
async function isAncestor(projectDir, ancestor, descendant) {
  try {
    await runGit(projectDir, [
      "merge-base",
      "--is-ancestor",
      ancestor,
      descendant
    ]);
    return true;
  } catch (error) {
    if (error instanceof GitCommandError && error.exitCode === 1) return false;
    throw error;
  }
}
async function evaluateGraphFreshness(snapshot, input, requestedGraphCommitHash) {
  let graphCommitHash;
  try {
    graphCommitHash = parseScalar(
      await runGit(snapshot.projectDir, [
        "rev-parse",
        "--verify",
        "--end-of-options",
        `${requestedGraphCommitHash}^{commit}`
      ])
    );
  } catch (error) {
    return {
      status: "unknown",
      reason: unknownReason(error, "graph-commit-unavailable"),
      graphCommitHash: requestedGraphCommitHash,
      headCommitHash: snapshot.headCommitHash,
      ...optionalAnalysisTime(input)
    };
  }
  let committedFiles;
  try {
    committedFiles = parseNulDelimitedPaths(
      await runGit(snapshot.projectDir, [
        "diff",
        "--name-only",
        "-z",
        "--relative",
        graphCommitHash,
        snapshot.headCommitHash,
        ...PROJECT_PATHSPEC
      ])
    );
  } catch (error) {
    return {
      status: "unknown",
      reason: unknownReason(error, "graph-commit-unavailable"),
      graphCommitHash,
      headCommitHash: snapshot.headCommitHash,
      ...optionalAnalysisTime(input)
    };
  }
  if (committedFiles.length === 0) {
    if (snapshot.dirtyFiles.length > 0) {
      return {
        status: "dirty",
        graphCommitHash,
        headCommitHash: snapshot.headCommitHash,
        changedFileCount: snapshot.dirtyFiles.length,
        changedFiles: snapshot.dirtyFiles,
        commitsBehind: 0,
        commitsAhead: 0,
        ...optionalAnalysisTime(input)
      };
    }
    return {
      status: "fresh",
      graphCommitHash,
      headCommitHash: snapshot.headCommitHash,
      changedFileCount: 0,
      changedFiles: [],
      commitsBehind: 0,
      commitsAhead: 0,
      ...optionalAnalysisTime(input)
    };
  }
  try {
    const [countsOutput, graphIsAncestor, headIsAncestor] = await Promise.all([
      runGit(snapshot.projectDir, [
        "rev-list",
        "--left-right",
        "--count",
        `${graphCommitHash}...${snapshot.headCommitHash}`,
        ...PROJECT_PATHSPEC
      ]),
      isAncestor(
        snapshot.projectDir,
        graphCommitHash,
        snapshot.headCommitHash
      ),
      isAncestor(
        snapshot.projectDir,
        snapshot.headCommitHash,
        graphCommitHash
      )
    ]);
    const [commitsAhead, commitsBehind] = parseScalar(countsOutput).split(/\s+/).map((value) => Number.parseInt(value, 10));
    if (!Number.isFinite(commitsAhead) || !Number.isFinite(commitsBehind) || commitsAhead < 0 || commitsBehind < 0) {
      throw new GitCommandError(null, false);
    }
    const relation = graphIsAncestor ? "behind" : headIsAncestor ? "ahead" : "diverged";
    const changedFiles = uniqueSortedPaths(
      committedFiles,
      snapshot.dirtyFiles
    );
    return {
      status: "stale",
      relation,
      graphCommitHash,
      headCommitHash: snapshot.headCommitHash,
      changedFileCount: changedFiles.length,
      changedFiles,
      commitsBehind,
      commitsAhead,
      ...optionalAnalysisTime(input)
    };
  } catch (error) {
    return {
      status: "unknown",
      reason: unknownReason(error, "graph-commit-unavailable"),
      graphCommitHash,
      headCommitHash: snapshot.headCommitHash,
      ...optionalAnalysisTime(input)
    };
  }
}
function parseChangedFiles(output) {
  return output.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
}
function getChangedFiles(projectDir, lastCommitHash) {
  try {
    const output = execFileSync("git", ["diff", `${lastCommitHash}..HEAD`, "--name-only"], {
      cwd: projectDir,
      encoding: "utf-8"
    });
    return parseChangedFiles(output);
  } catch {
    return [];
  }
}
function isStale(projectDir, lastCommitHash) {
  const changedFiles = getChangedFiles(projectDir, lastCommitHash);
  return {
    stale: changedFiles.length > 0,
    changedFiles
  };
}
async function getGraphFreshnessBatch(projectDir, inputs) {
  const entries = Object.entries(inputs);
  const results = {};
  const comparableEntries = [];
  for (const [key, input] of entries) {
    const graphCommitHash = input.graphCommitHash?.trim();
    if (!graphCommitHash) {
      results[key] = {
        status: "unknown",
        reason: "missing-graph-commit",
        ...optionalAnalysisTime(input)
      };
      continue;
    }
    comparableEntries.push([key, input, graphCommitHash]);
  }
  if (comparableEntries.length === 0) return results;
  let snapshot;
  try {
    snapshot = await createProjectGitSnapshot(projectDir);
  } catch (error) {
    const reason = unknownReason(error, "git-head-unavailable");
    for (const [key, input, graphCommitHash] of comparableEntries) {
      results[key] = {
        status: "unknown",
        reason,
        graphCommitHash,
        ...optionalAnalysisTime(input)
      };
    }
    return results;
  }
  await Promise.all(
    comparableEntries.map(async ([key, input, graphCommitHash]) => {
      results[key] = await evaluateGraphFreshness(
        snapshot,
        input,
        graphCommitHash
      );
    })
  );
  return results;
}
async function getGraphFreshness(projectDir, input) {
  const results = await getGraphFreshnessBatch(projectDir, { graph: input });
  return results.graph;
}
function mergeGraphUpdate(existingGraph, changedFilePaths, newNodes, newEdges, newCommitHash) {
  const changedSet = new Set(changedFilePaths);
  const removedNodeIds = new Set(
    existingGraph.nodes.filter((node) => node.filePath !== void 0 && changedSet.has(node.filePath)).map((node) => node.id)
  );
  const retainedNodes = existingGraph.nodes.filter(
    (node) => !removedNodeIds.has(node.id)
  );
  const retainedEdges = existingGraph.edges.filter(
    (edge) => !removedNodeIds.has(edge.source) && !removedNodeIds.has(edge.target)
  );
  return {
    ...existingGraph,
    project: {
      ...existingGraph.project,
      gitCommitHash: newCommitHash,
      analyzedAt: (/* @__PURE__ */ new Date()).toISOString()
    },
    nodes: [...retainedNodes, ...newNodes],
    edges: [...retainedEdges, ...newEdges]
  };
}
export {
  getChangedFiles,
  getGraphFreshness,
  getGraphFreshnessBatch,
  isStale,
  mergeGraphUpdate
};
