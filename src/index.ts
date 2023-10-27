import { readdir as fsReaddir } from "fs/promises";
import { existsSync as fsExistsSync, readFileSync as fsReadFileSync } from "fs";
import { join as pathJoin } from "path";

type OwnerNode = {
  noParent: boolean;
  owners: string[];
  perFileOwners: { [pattern: string]: string[] };
};

const OWNERS_FILE_NAME = "OWNERS";
const BASE_DIR = "../minh-codeownership-spike/";
const IGNORING_RGX = new RegExp(
  "(?:" + ["^.git", "node_modules", `${OWNERS_FILE_NAME}$`].join("|") + ")"
);

async function main() {
  const pathToOwners = new Map<string, string[] | undefined>();

  // Scan all files and folders inside
  await walkInto([], []);

  console.log(pathToOwners);

  /**
   * Walk the directory tree in DFS
   */
  async function walkInto(
    pathSegments: string[],
    parentOwnerNodes: OwnerNode[]
  ) {
    const path = pathJoin(...pathSegments);
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
      } else {
        if (!IGNORING_RGX.test(childNodePath)) {
          pathToOwners.set(childNodePath, mergedOwnerNode.owners);
        }
      }
    }
  }
}

function mergeOwnersNodes(
  currentOwnersNode: OwnerNode | undefined,
  parentOwnerNodes: OwnerNode[]
): Omit<OwnerNode, 'noParent'> {
  const owners = new Set<string>();
  const perFileOwners = {};

  // TODO handle per-file

  const ownersNodes =
    currentOwnersNode != null
      ? [currentOwnersNode, ...parentOwnerNodes]
      : parentOwnerNodes;

  for (const ownersNode of ownersNodes) {
    ownersNode.owners.forEach((o) => {
      owners.add(o);
    });
    if (ownersNode.noParent) {
      break;
    }
  }

  return {
    owners: [...owners],
    perFileOwners,
  };
}

function parseOwnersFile(pathSegments: string[]): OwnerNode | undefined {
  const path = pathJoin(BASE_DIR, ...pathSegments, OWNERS_FILE_NAME);
  if (!fsExistsSync(path)) {
    return;
  }

  const content = fsReadFileSync(path, "utf8");
  const lines = content.trim().split(/\s*\n+\s*/);

  const noParent = lines.includes("set noparent");
  const owners = lines.filter((line) => line !== "set noparent");
  const perFileOwners = {};

  // TODO parse per-file

  return {
    noParent,
    owners,
    perFileOwners,
  };
}

main();
