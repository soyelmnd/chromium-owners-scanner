#!/usr/bin/env node

import { promisify } from "util";
import { exec as childProcessExec } from "child_process";
import { readdir as fsReaddir } from "fs/promises";
import { existsSync as fsExistsSync, readFileSync as fsReadFileSync } from "fs";
import { join as pathJoin } from "path";
import { Table } from "console-table-printer";

const exec = promisify(childProcessExec);

type OwnerNode = {
  noParent: boolean;
  /**
   * Empty means no owners
   */
  owners: string[];
  perFile: Map</* pattern */ string, Omit<OwnerNode, "perFile">>;
};

const OWNERS_FILE_NAME = "OWNERS";

// TODO subcommand to not list everything at once
// TODO take the list of exclusion from .gitignore if available. Or git ls-files instead?
// TODO auto set git repo root as the BASE_DIR
const BASE_DIR = process.cwd();
const IGNORING_RGX = new RegExp(
  "(?:" +
    ["^\./", "\.git", "node_modules", `${OWNERS_FILE_NAME}$`].join("|") +
    ")"
);

async function scanOwners() {
  const pathToOwners = new Map<string, string[]>();

  // Scan all files and folders inside
  await walkInto([], []);

  return {
    pathToOwners,
  };

  /**
   * Walk the directory tree in DFS
   */
  async function walkInto(
    pathSegments: string[],
    parentOwnerNodes: OwnerNode[]
  ) {
    // A trailing / should help tell us this is a folder at a glance
    const path = pathJoin(...pathSegments) + "/";
    const currentOwnersNode = parseOwnersFile(path);
    const mergedOwnerNode = mergeOwnersNodes(
      currentOwnersNode,
      parentOwnerNodes
    );

    if (!IGNORING_RGX.test(path)) {
      pathToOwners.set(path, mergedOwnerNode.owners);
    }

    const ownersNodes = currentOwnersNode
      ? [currentOwnersNode, ...parentOwnerNodes]
      : parentOwnerNodes;

    const childrenNodes = await fsReaddir(pathJoin(BASE_DIR, ...pathSegments), {
      withFileTypes: true,
    });

    for (const childNode of childrenNodes) {
      const isDir = childNode.isDirectory();

      const childNodeName = childNode.name;
      const childNodePathSegments = [...pathSegments, childNodeName];
      const childNodePath = pathJoin(...childNodePathSegments);

      if (isDir) {
        await walkInto(childNodePathSegments, ownersNodes);
        continue;
      }

      if (IGNORING_RGX.test(childNodePath)) {
        continue;
      }

      let perFileOwnersApplied = false;
      for (const [perFilePattern, perFileNode] of mergedOwnerNode.perFile) {
        if (matchPattern(perFilePattern, childNodeName)) {
          pathToOwners.set(childNodePath, perFileNode.owners);
          perFileOwnersApplied = true;
          break;
        }
      }

      if (!perFileOwnersApplied) {
        pathToOwners.set(childNodePath, mergedOwnerNode.owners);
      }
    }
  }
}

function matchPattern(pattern: string, nodeName: string) {
  if (pattern.includes("*")) {
    const rgx = new RegExp(pattern.replace(/\*/g, "(?:.+?)"));
    return rgx.test(nodeName);
  }
  return pattern === nodeName;
}

function mergeOwnersNodes(
  currentOwnersNode: OwnerNode | undefined,
  parentOwnerNodes: OwnerNode[]
): OwnerNode {
  const owners: string[] = [];

  const ownersNodes =
    currentOwnersNode != null
      ? [currentOwnersNode, ...parentOwnerNodes]
      : parentOwnerNodes;

  for (const ownersNode of ownersNodes) {
    owners.push(...ownersNode.owners);

    if (ownersNode.noParent) {
      break;
    }
  }

  // Please note the perFile rules do not propagate to descendant folders
  const perFile: OwnerNode["perFile"] = new Map();
  if (currentOwnersNode) {
    for (const [perFilePattern, perFileNode] of currentOwnersNode.perFile) {
      perFile.set(perFilePattern, {
        noParent: true, // not used, update the type?
        owners: uniqueArray([...perFileNode.owners, ...owners]),
      });
    }
  }

  return {
    noParent: true, // not used, update the type?
    owners: uniqueArray(owners),
    perFile,
  };
}

/**
 * @param path path to the directory or the OWNERS file itself
 * @returns
 */
function parseOwnersFile(path: string): OwnerNode | undefined {
  const pathSegments = [BASE_DIR, path];
  if (!path.endsWith(OWNERS_FILE_NAME)) {
    pathSegments.push(OWNERS_FILE_NAME);
  }

  const ownersFullPath = pathJoin(...pathSegments);
  if (!fsExistsSync(ownersFullPath)) {
    return;
  }

  const lines = loadFile(ownersFullPath);

  // Including other files
  // Note: this _can_ cause an infinite loop
  for (const line of lines) {
    const matches = line.match(/^(include\s+|file:)(.+)/);
    if (!matches) {
      continue;
    }

    if (!line.endsWith(OWNERS_FILE_NAME)) {
      throw new Error(`Invalid include syntax: "${line}" should point to an OWNERS file`);
    }

    const [_wholeMatch, directive, includePath] = matches;

    // The file: directive would skip per-file and `set noparent` rules
    const skipImplicitGrant = directive === 'file:';

    const includeFullPath = includePath.startsWith("/")
      ? pathJoin(BASE_DIR, includePath)
      : pathJoin(BASE_DIR, path, includePath);

    const includeLines = loadFile(includeFullPath);
    const filteredIncludeLines = skipImplicitGrant
      ? includeLines.filter(line => !/^(?:per-file|set noparent)\b/.test(line))
      : includeLines;

    lines.push(...filteredIncludeLines);
  }

  const noParent = lines.includes("set noparent");
  const owners = lines.filter(
    (line) => !/^(?:include\b|file:|per-file\b|set noparent\b|[*#])/.test(line)
  );

  const perFile: OwnerNode["perFile"] = new Map();
  const perFileLines = lines.filter((line) => /^per-file\s/.test(line));
  perFileLines.forEach((perFileLine) => {
    const matches = perFileLine.match(/per-file\s+(.+?)\s*=\s*(.+)/);
    if (!matches) {
      return;
    }

    const [_wholeMatch, perFilePatterns, perFileDirective] = matches;

    perFilePatterns.split(/\s*,\s*/).forEach((perFilePattern) => {
      // TODO per-file does not support `set noparent` yet
      // TODO per-file does not support `file` yet

      const perFileOwners =
        perFileDirective === "*" ? [] : perFileDirective.split(/,/g);

      perFile.set(perFilePattern, {
        noParent: false,
        owners: uniqueArray([...perFileOwners, ...owners]),
      });
    });
  });

  return {
    noParent,
    owners,
    perFile,
  };
}

function loadFile(fullPath: string): string[] {
  return splitLines(fsReadFileSync(fullPath, "utf8"));
}

function splitLines(text: string): string[] {
  return text.trim().split(/\s*\n+\s*/);
}

function uniqueArray<T>(items: T[]): T[] {
  return [...new Set(items)];
}

async function main() {
  const { pathToOwners } = await scanOwners();

  const filesTable = new Table({
    columns: [
      { name: "path", alignment: "left", title: "File" },
      { name: "owners", alignment: "right", title: "Owners" },
    ],
  });

  const unownedFiles: string[] = [];

  const ownersStats: {
    [key: string]: { owner: string; filesOwned: number };
  } = {};

  const { stdout: gitLsFilesOutput } = await exec(`cd ${BASE_DIR}; git ls-files`);
  const gitFiles = new Set(splitLines(gitLsFilesOutput));

  const fileStats = {
    filesCount: 0,
    filesOwnedCount: 0,
  };

  // It is actually a { [coownersCount: number]: number } map. Sorry for abusing array :grimacing:
  const coownersCountMap: number[] = [];

  pathToOwners.forEach((owners, path) => {
    if (!gitFiles.has(path)) {
      return;
    }

    const isOwned = owners.length;
    const isDir = path.endsWith("/");

    if (!isDir) {
      if (!isOwned) {
        unownedFiles.push(path);
      }

      ++fileStats.filesCount;
      if (isOwned) {
        ++fileStats.filesOwnedCount;
      }

      // Co-owners count can be helpful in ensuring the right ownership is there
      coownersCountMap[owners.length] = (coownersCountMap[owners.length] || 0) + 1;
    }

    owners.forEach((owner) => {
      ownersStats[owner] = ownersStats[owner] || {
        owner,
        filesOwned: 0,
      };

      if (!isDir) {
        ++ownersStats[owner].filesOwned;
      }
    });

    const color = isOwned ? "green" : "red";
    filesTable.addRow({ path, owners }, { color });
  });

  // Printing the entire files and folders along with their ownership
  filesTable.printTable();

  // Printing the owners billboard
  new Table({
    rows: Object.values(ownersStats)
      .sort((a, b) => b.filesOwned - a.filesOwned)
      .map((o) => ({
        Owner: o.owner,
        ["Files owned"]: o.filesOwned,
        ["% of the repo files"]: percentage(o.filesOwned, fileStats.filesCount),
      })),
  }).printTable();

  // Printing owners-per-file statistics
  if (coownersCountMap.length) {
    const coownersCountTable = new Table();
    coownersCountMap.forEach((filesCount, coownersCount) => {
      let color: string | undefined;
      if (coownersCount < 2) {
        color = "red";
      } else if (coownersCount > 3) {
        color = "yellow";
      }

      coownersCountTable.addRow(
        {
          ["Number of co-owners per file"]: coownersCount,
          ["Number of files"]: filesCount,
        },
        {
          color,
        }
      );
    });
    coownersCountTable.printTable();
  }

  // Printing unowned paths
  new Table({
    columns: [
      {
        name: "path",
        alignment: "left",
        title: "Files with no owners",
        color: "red",
      },
    ],
    rows: unownedFiles.map((value) => ({ path: value })),
  }).printTable();

  // Printing file statistics
  new Table()
    .addRow(
      { Stats: "Total files", Value: fileStats.filesCount },
      { color: "green" }
    )
    .addRow({ Stats: "Files with owners", Value: fileStats.filesOwnedCount })
    .addRow({
      Stats: "Files with owners (%)",
      Value: percentage(fileStats.filesOwnedCount, fileStats.filesCount),
    })
    .printTable();
}

function percentage(x: number, total: number) {
  return ((x / total) * 100).toFixed(2) + "%";
}

main();
