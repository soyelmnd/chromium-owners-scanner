#!/usr/bin/env node

import { Table } from "console-table-printer";
import { BASE_DIR, getGitFiles, scanOwners } from "./lib";

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
    [path: string]: { owner: string; filesOwned: number };
  } = {};

  const fileStats = {
    filesCount: 0,
    filesOwnedCount: 0,
  };

  // It is actually a { [coownersCount: number]: number } map. Sorry for abusing array :grimacing:
  const coownersCountMap: number[] = [];

  const gitFiles = await getGitFiles();

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
      coownersCountMap[owners.length] =
        (coownersCountMap[owners.length] || 0) + 1;
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
