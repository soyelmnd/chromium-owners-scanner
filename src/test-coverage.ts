#!/usr/bin/env node

import { Table } from "console-table-printer";
import { BASE_DIR, getGitFiles, PathToOwnerMap, scanOwners } from "./lib";
import { readFile, writeFile } from "fs/promises";
import type { CoverageMapData } from "istanbul-lib-coverage";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

async function main() {
  const { pathToCoverageJson, pathToBaselineCoverageJson, output } = yargs(
    hideBin(process.argv)
  )
    .option("pathToCoverageJson", {
      alias: "p",
      type: "string",
      default: "coverage/coverage-final.json",
      description: "Path to coverage-final.json",
    })
    .option("pathToBaselineCoverageJson", {
      alias: "b",
      type: "string",
      default: undefined,
      description: "Path to the baseline coverage-final.json for comparison",
    })
    .option("output", {
      alias: "o",
      type: "string",
      default: undefined,
      description:
        "Output path to write the detailed report to, useful to manually verify the numbers I guess",
    })
    .parseSync();

  const coverageMapData = await loadCoverageMapData(pathToCoverageJson);
  const baselineCoverageMapData = pathToBaselineCoverageJson
    ? await loadCoverageMapData(pathToBaselineCoverageJson)
    : undefined;

  const { pathToOwners } = await scanOwners();

  const gitFiles = await getGitFiles();

  const { ownerCoverage, ownerCoverageSummary } = await mapOwnerCoverageInfo({
    coverageMapData,
    pathToOwners,
    gitFiles,
  });

  if (baselineCoverageMapData) {
    // When there's a baseline coverage, we'd sort the table by the highest _difference_
    // in the number of covered statements (not the typical covered statements themselves)
    const { ownerCoverageSummary: baselineOwnerCoverageSummary } =
      await mapOwnerCoverageInfo({
        coverageMapData: baselineCoverageMapData,
        pathToOwners,
        gitFiles,
      });

    new Table({
      rows: Object.entries(ownerCoverageSummary)
        .map(
          ([
            owner,
            { totalStatements, coveredStatements, coveredStatementsRatio },
          ]) => {
            const baselineCoveredStatements =
              baselineOwnerCoverageSummary[owner]?.coveredStatements || 0;

            return {
              owner,
              totalStatements,
              coveredStatements,
              changedCoveredStatements:
                coveredStatements - baselineCoveredStatements,
              coveredStatementsRatio:
                (coveredStatementsRatio * 100).toFixed(2) + "%",
            };
          }
        )
        .sort(
          (a, b) => b.changedCoveredStatements - a.changedCoveredStatements
        ),
    }).printTable();
  } else {
    new Table({
      rows: Object.entries(ownerCoverageSummary)
        .map(
          ([
            owner,
            { totalStatements, coveredStatements, coveredStatementsRatio },
          ]) => ({
            owner,
            totalStatements,
            coveredStatements,
            coveredStatementsRatio:
              (coveredStatementsRatio * 100).toFixed(2) + "%",
          })
        )
        .sort((a, b) => b.coveredStatements - a.coveredStatements),
    }).printTable();
  }

  if (output) {
    await writeFile(
      output,
      JSON.stringify({
        summarizedOwnerCoverages: ownerCoverageSummary,
        ownerCoveragesMap: ownerCoverage,
      })
    );
  }
}

async function mapOwnerCoverageInfo({
  coverageMapData,
  pathToOwners,
  gitFiles,
}: {
  coverageMapData: CoverageMapData;
  pathToOwners: PathToOwnerMap;
  gitFiles: Set<string>;
}) {
  const ownerCoverage: {
    [owner: string]: {
      [path: string]: {
        path: string;
        totalStatements: number;
        coveredStatements: number;
        coveredStatementsRatio: number;
      };
    };
  } = {};
  const ownerCoverageSummary: {
    [owner: string]: {
      totalStatements: number;
      coveredStatements: number;
      coveredStatementsRatio: number;
    };
  } = {};

  pathToOwners.forEach((owners, path) => {
    if (!gitFiles.has(path)) {
      return;
    }
    if (!owners.length) {
      return;
    }
    // TODO(Minh) this only works with full path. Should be a better way around, e.g. tweak the coverage collection to have relative path?
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
      if (!ownerCoverage[owner]) {
        ownerCoverage[owner] = {};
      }
      ownerCoverage[owner][path] = {
        path,
        totalStatements,
        coveredStatements,
        coveredStatementsRatio: coveredStatements / totalStatements,
      };

      if (!ownerCoverageSummary[owner]) {
        ownerCoverageSummary[owner] = {
          totalStatements: 0,
          coveredStatements: 0,
          coveredStatementsRatio: 0, // more like undefined at this point but
        };
      }
      ownerCoverageSummary[owner].totalStatements += totalStatements;
      ownerCoverageSummary[owner].coveredStatements += coveredStatements;
    });
  });

  Object.values(ownerCoverageSummary).forEach((coverageSummaryPerOwner) => {
    coverageSummaryPerOwner.coveredStatementsRatio =
      coverageSummaryPerOwner.coveredStatements /
        coverageSummaryPerOwner.totalStatements || 0;
  });

  return {
    ownerCoverage,
    ownerCoverageSummary,
  };
}

async function loadCoverageMapData(
  pathToCoverageJson: string
): Promise<CoverageMapData> {
  // TODO error handling for readFile
  const coverageMapData = JSON.parse(
    await readFile(pathToCoverageJson, "utf-8")
  );

  // TODO verify the data

  return coverageMapData as any;
}

main();
