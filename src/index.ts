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
  const content = fsReadFileSync(fullPath, "utf8");
  const lines = content.trim().split(/\s*\n+\s*/);

  return lines;
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

  const ownersStats: {
    [key: string]: { owner: string; dirsOwned: number; filesOwned: number };
  } = {};

  const fileStats = {
    dirsCount: 0,
    dirsOwnedCount: 0,
    filesCount: 0,
    filesOwnedCount: 0,
  };

  const pathsByOwnersCount: string[][] = [];

  pathToOwners.forEach((owners, path) => {
    const isOwned = owners.length;
    const isDir = path.endsWith("/");

    if (!isOwned) {
      unownedPath.push(path);
    }

    if (isDir) {
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

    // Owners count can be helpful in ensuring the right ownership is there
    pathsByOwnersCount[owners.length] = [
      ...(pathsByOwnersCount[owners.length] || []),
      path,
    ];

    owners.forEach((owner) => {
      ownersStats[owner] = ownersStats[owner] || {
        owner,
        dirsOwned: 0,
        filesOwned: 0,
      };

      if (isDir) {
        ++ownersStats[owner].dirsOwned;
      } else {
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
      .sort((a, b) => {
        const aTotal = a.dirsOwned + a.filesOwned;
        const bTotal = b.dirsOwned + b.filesOwned;

        return bTotal - aTotal || b.dirsOwned - a.dirsOwned;
      })
      .map((o) => ({
        Owner: o.owner,
        ["Directories"]: o.dirsOwned,
        ["Files"]: o.filesOwned,
        ["Directories (%)"]: percentage(o.dirsOwned, fileStats.dirsCount),
        ["Files (%)"]: percentage(o.filesOwned, fileStats.filesCount),
        ["Total (%)"]: percentage(
          o.dirsOwned + o.filesOwned,
          fileStats.dirsCount + fileStats.filesCount
        ),
      })),
  }).printTable();

  // Printing paths with
  const ownersCountTable = new Table();
  pathsByOwnersCount.forEach((paths, ownersCount) => {
    let color: string | undefined;
    if (ownersCount < 2) {
      color = "red";
    } else if (ownersCount > 3) {
      color = "yellow";
    }

    ownersCountTable.addRow(
      {
        ["Owners count"]: ownersCount,
        ["Count"]: paths.length,
      },
      {
        color,
      }
    );
  });
  ownersCountTable.printTable();

  // Printing unowned paths
  new Table({
    columns: [
      {
        name: "path",
        alignment: "left",
        title: "No owners",
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
