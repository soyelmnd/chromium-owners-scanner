#!/usr/bin/env node

import { Table } from "console-table-printer";
import { BASE_DIR, exec, getGitFiles, scanOwners, splitLines } from "./lib";
import { runCLI } from "jest";

async function main() {
  const { pathToOwners } = await scanOwners();

  // TODO error handling for the runCLI

  const {
    results: { coverageMap },
  } = await runCLI(
    {
      coverage: true,
      _: [],
      $0: "",
      silent: true,
    },
    [BASE_DIR]
  );

  const coverageMapData = coverageMap?.data;
  if (!coverageMapData) {
    console.log("No coverage hmm - why?");
    return;
  }

  const ownerCoveragesMap: {
    [owner: string]: {
      [path: string]: {
        path: string;
        totalStatements: number;
        coveredStatements: number;
        coveredStatementsRatio: number;
      };
    };
  } = {};
  const summarizedOwnerCoverages: {
    [owner: string]: {
      totalStatements: number;
      coveredStatements: number;
      coveredStatementsRatio: number;
    };
  } = {};

  const gitFiles = await getGitFiles();

  pathToOwners.forEach((owners, path) => {
    if (!gitFiles.has(path)) {
      return;
    }
    if (!owners.length) {
      return;
    }
    const coverage = coverageMapData[BASE_DIR + "/" + path];
    if (!coverage) {
      return;
    }

    const totalStatements = Object.keys(coverage.statementMap).length;
    const coveredStatements = Object.values(coverage.s).reduce(
      (coveredLines, thisLine) => coveredLines + (thisLine ? 1 : 0),
      0
    );

    owners.forEach((owner) => {
      if (!ownerCoveragesMap[owner]) {
        ownerCoveragesMap[owner] = {};
      }
      ownerCoveragesMap[owner][path] = {
        path,
        totalStatements,
        coveredStatements,
        coveredStatementsRatio: coveredStatements / totalStatements,
      };

      if (!summarizedOwnerCoverages[owner]) {
        summarizedOwnerCoverages[owner] = {
          totalStatements: 0,
          coveredStatements: 0,
          coveredStatementsRatio: 0, // more like undefined at this point but
        };
      }
      summarizedOwnerCoverages[owner].totalStatements += totalStatements;
      summarizedOwnerCoverages[owner].coveredStatements += coveredStatements;
    });
  });

  Object.values(summarizedOwnerCoverages).forEach((coverageSummaryPerOwner) => {
    coverageSummaryPerOwner.coveredStatementsRatio =
      coverageSummaryPerOwner.coveredStatements /
      coverageSummaryPerOwner.totalStatements;
  });

  new Table({
    rows: Object.entries(summarizedOwnerCoverages)
      .map(
        ([
          owner,
          { totalStatements, coveredStatements, coveredStatementsRatio },
        ]) => {
          return {
            owner,
            totalStatements,
            coveredStatements,
            coveredStatementsRatio: (coveredStatementsRatio * 100).toFixed(2) + '%',
          };
        }
      )
      .sort((a, b) => b.coveredStatements - a.coveredStatements),
  }).printTable();
}

main();
