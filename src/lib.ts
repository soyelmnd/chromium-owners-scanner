#!/usr/bin/env node

import { promisify } from "util";
import { exec as childProcessExec } from "child_process";
import { readdir as fsReaddir } from "fs/promises";
import { existsSync as fsExistsSync, readFileSync as fsReadFileSync } from "fs";
import { join as pathJoin } from "path";
import { Table } from "console-table-printer";

export const exec = promisify(childProcessExec);

type OwnerNode = {
  noParent: boolean;
  /**
   * Empty means no owners
   */
  owners: string[];
  perFile: Map</* pattern */ string, Omit<OwnerNode, "perFile">>;
};

const OWNERS_FILE_NAME = "OWNERS";

// TODO error handling

// TODO tests and code split

// TODO subcommand to not list everything at once
// TODO refactor IGNORING_RGX to be configurable esp when this is not a git repo
// TODO auto set git repo root as the BASE_DIR
export const BASE_DIR = process.cwd();
const IGNORING_RGX = new RegExp(
  "(?:" +
    ["^./", ".git", "node_modules", `${OWNERS_FILE_NAME}$`].join("|") +
    ")"
);

export type PathToOwnerMap = Map</* path to file */ string, /* owners */ string[]>;

export async function scanOwners() {
  const pathToOwners: PathToOwnerMap = new Map();

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
      throw new Error(
        `Invalid include syntax: "${line}" should point to an OWNERS file`
      );
    }

    const [_wholeMatch, directive, includePath] = matches;

    // The file: directive would skip per-file and `set noparent` rules
    const skipImplicitGrant = directive === "file:";

    const includeFullPath = includePath.startsWith("/")
      ? pathJoin(BASE_DIR, includePath)
      : pathJoin(BASE_DIR, path, includePath);

    const includeLines = loadFile(includeFullPath);
    const filteredIncludeLines = skipImplicitGrant
      ? includeLines.filter(
          (line) => !/^(?:per-file|set noparent)\b/.test(line)
        )
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

export async function getGitFiles() {
  const { stdout: gitLsFilesOutput } = await exec(
    `cd ${BASE_DIR}; git ls-files`
  );
  return new Set(splitLines(gitLsFilesOutput));
}

function loadFile(fullPath: string): string[] {
  return splitLines(fsReadFileSync(fullPath, "utf8"));
}

export function splitLines(text: string): string[] {
  return text.trim().split(/\s*\n+\s*/);
}

function uniqueArray<T>(items: T[]): T[] {
  return [...new Set(items)];
}