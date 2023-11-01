import { readdir as fsReaddir } from "fs/promises";
import { existsSync as fsExistsSync, readFileSync as fsReadFileSync } from "fs";
import { join as pathJoin } from "path";
import { Table } from "console-table-printer";

type OwnerNode = {
  noParent: boolean;
  /**
   * Empty means no owners
   */
  owners: string[];
  perFile: Map</* pattern */ string, Omit<OwnerNode, "perFile">>;
};

const OWNERS_FILE_NAME = "OWNERS";
const BASE_DIR = "../minh-codeownership-spike/";
const IGNORING_RGX = new RegExp(
  "(?:" +
    ["^./", "^.git", "node_modules", `${OWNERS_FILE_NAME}$`].join("|") +
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
    const currentOwnersNode = parseOwnersFile(pathSegments);
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

function parseOwnersFile(pathSegments: string[]): OwnerNode | undefined {
  const path = pathJoin(BASE_DIR, ...pathSegments, OWNERS_FILE_NAME);
  if (!fsExistsSync(path)) {
    return;
  }

  const perFile: OwnerNode["perFile"] = new Map();

  const content = fsReadFileSync(path, "utf8");
  const lines = content.trim().split(/\s*\n+\s*/);

  const noParent = lines.includes("set noparent");
  const owners = lines.filter(
    (line) => !/^(?:per-file\b|set noparent\b|[*#])/.test(line)
  );

  // TODO file: directive

  const perFileLines = lines.filter((line) => /^per-file\s/.test(line));
  perFileLines.forEach((perFileLine) => {
    const segments = perFileLine.match(/per-file\s+(.+?)\s*=\s*(.+)/);
    if (!segments) {
      return;
    }

    const [_wholeMatch, perFilePatterns, perFileDirective] = segments;

    perFilePatterns.split(/\s*,\s*/).forEach((perFilePattern) => {
      // TODO per-file does not support set no parent yet

      const perFileOwners =
        perFileDirective === "*" ? [] : perFileDirective.split(/\s*,\s*/g);

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

function uniqueArray<T>(items: T[]): T[] {
  return [...new Set(items)];
}

async function main() {
  const { pathToOwners } = await scanOwners();

  const filesTable = new Table({
    columns: [
      { name: "path", alignment: "left", title: "Path" },
      { name: "owners", alignment: "right", title: "Owners" },
    ],
  });

  const unownedPath: string[] = [];

  const fileStats = {
    dirsCount: 0,
    dirsOwnedCount: 0,
    filesCount: 0,
    filesOwnedCount: 0,
  };

  pathToOwners.forEach((owners, path) => {
    const isOwned = owners.length;

    if (!isOwned) {
      unownedPath.push(path);
    }

    if (path.endsWith("/")) {
      ++fileStats.dirsCount;
      if (isOwned) {
        ++fileStats.dirsOwnedCount;
      }
    } else {
      ++fileStats.filesCount;
      if (isOwned) {
        ++fileStats.filesOwnedCount;
      }
    }

    const color = isOwned ? "green" : "red";
    filesTable.addRow({ path, owners }, { color });
  });

  filesTable.printTable();

  // Printing unowned paths
  new Table({
    columns: [
      {
        name: "path",
        alignment: "left",
        title: "No owners path",
        color: "red",
      },
    ],
    rows: unownedPath.map((value) => ({ path: value })),
  }).printTable();

  // Printing file statistics
  new Table()
    .addRow(
      { Stats: "Total directories", Value: fileStats.dirsCount },
      { color: "green" }
    )
    .addRow({
      Stats: "Directories with owners",
      Value: fileStats.dirsOwnedCount,
    })
    .addRow({
      Stats: "Directories with owners (%)",
      Value: percentage(fileStats.dirsOwnedCount, fileStats.dirsCount),
    })
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
