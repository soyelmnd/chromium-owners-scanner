#!/usr/bin/env node

import { Table } from "console-table-printer";
import { BASE_DIR, getGitFiles, PathToOwnerMap, scanOwners } from "./lib";
import { readFile, writeFile } from "fs/promises";
// TODO(Minh) correct the import as it is not even in dep list yet
import type { CoverageSummaryData } from "istanbul-lib-coverage";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { ColumnOptionsRaw } from "console-table-printer/dist/src/models/external-table";

type CoverageSummaryDataMap = { [path: string]: CoverageSummaryData };

// TODO(Minh) correct the naming of these lazy little helper variables
const types = ["statements", "lines", "functions", "branches"] as const;
const props = ["total", "covered", "skipped"] as const;

async function main() {
  const { coverageSummaryJson, baselineCoverageSummaryJson, output } = yargs(
    hideBin(process.argv)
  )
    .option("coverageSummaryJson", {
      alias: "p",
      type: "string",
      default: "coverage/coverage-summary.json",
      description: "Path to coverage-summary.json",
    })
    .option("baselineCoverageSummaryJson", {
      alias: "b",
      type: "string",
      default: undefined,
      description: "Path to the baseline coverage-summary.json for comparison",
    })
    .parseSync();

  const coverageSummaryDataMap = await loadCoverageSummaryDataMap(
    coverageSummaryJson
  );

  const { pathToOwners } = await scanOwners();
  const gitFiles = await getGitFiles();

  const { ownerCoverageSummary } = await mapOwnerCoverageInfo({
    coverageSummaryDataMap,
    pathToOwners,
    gitFiles,
  });

  const columns: ColumnOptionsRaw[] = [
    { name: "owner", title: "Owner" },
    { name: "totalStatements", title: "Statements" },
    { name: "coveredStatements", title: "Covered statements", color: "green" },
    {
      name: "diffCoveredStatements",
      title: "DIFF",
      color: "yellow",
    },
    { name: "totalBranches", title: "Branches" },
    { name: "coveredBranches", title: "Covered branches" },
    { name: "totalFunctions", title: "Functions" },
    { name: "coveredFunctions", title: "Covered functions" },
  ];
  const disabledColumns = ["_coveredStatementsCount"];

  const sortedReportRows = Object.entries(ownerCoverageSummary)
    .map(([owner, { statements, branches, functions }]) => ({
      owner,
      totalStatements: statements.total,
      coveredStatements: `${statements.covered} (${statements.pct}%)`,
      totalBranches: branches.total,
      coveredBranches: `${branches.covered} (${branches.pct}%)`,
      totalFunctions: functions.total,
      coveredFunctions: `${functions.covered} (${functions.pct}%)`,

      diffCoveredStatements: 0,

      // Yup this is used for sorting and diffing, not visible on screen, hence the _ naming
      _coveredStatementsCount: statements.covered,
    }))
    .sort((a, b) => b._coveredStatementsCount - a._coveredStatementsCount);

  // Assuming when we pass baseline, we wanna see the _difference_ instead of the typical covered statements count
  if (baselineCoverageSummaryJson) {
    const baselineCoverageSummaryDataMap = await loadCoverageSummaryDataMap(
      baselineCoverageSummaryJson
    );

    const { ownerCoverageSummary: baselineOwnerCoverageSummary } =
      await mapOwnerCoverageInfo({
        coverageSummaryDataMap: baselineCoverageSummaryDataMap,
        pathToOwners,
        gitFiles,
      });

    sortedReportRows.forEach((row) => {
      const baselineCoveredStatements =
        baselineOwnerCoverageSummary[row.owner]?.statements.covered || 0;

      row.diffCoveredStatements =
        row._coveredStatementsCount - baselineCoveredStatements;
    });

    sortedReportRows.sort((a, b) => {
      if (b.diffCoveredStatements !== a.diffCoveredStatements) {
        return b.diffCoveredStatements - a.diffCoveredStatements;
      }
      return b._coveredStatementsCount - a._coveredStatementsCount;
    });
  } else {
    disabledColumns.push("diffCoveredStatements");
  }

  const reportTable = new Table({ columns, disabledColumns });
  reportTable.addRows(sortedReportRows);
  reportTable.printTable();
}

async function mapOwnerCoverageInfo({
  coverageSummaryDataMap,
  pathToOwners,
  gitFiles,
}: {
  coverageSummaryDataMap: CoverageSummaryDataMap;
  pathToOwners: PathToOwnerMap;
  gitFiles: Set<string>;
}) {
  const ownerCoverageSummary: {
    [owner: string]: CoverageSummaryData;
  } = {};

  pathToOwners.forEach((owners, path) => {
    if (!gitFiles.has(path)) {
      return;
    }
    if (!owners.length) {
      return;
    }
    // TODO(Minh) this only works with full path. Should be a better way around, e.g. tweak the coverage collection to have relative path?
    const coverage = coverageSummaryDataMap[BASE_DIR + "/" + path];
    if (!coverage) {
      return;
    }

    owners.forEach((owner) => {
      if (!ownerCoverageSummary[owner]) {
        ownerCoverageSummary[owner] = {
          statements: { total: 0, covered: 0, skipped: 0, pct: 0 },
          lines: { total: 0, covered: 0, skipped: 0, pct: 0 },
          functions: { total: 0, covered: 0, skipped: 0, pct: 0 },
          branches: { total: 0, covered: 0, skipped: 0, pct: 0 },
        };
      }

      types.forEach((type) => {
        props.forEach((prop) => {
          ownerCoverageSummary[owner][type][prop] += coverage[type][prop];
        });
      });
    });
  });

  Object.values(ownerCoverageSummary).forEach((perOwner) => {
    types.forEach((type) => {
      // Yup we want to have 2 decimal after the dot, similar to the original coverage summary
      perOwner[type].pct =
        Math.round(
          10000 * (perOwner[type].covered / perOwner[type].total || 0)
        ) / 100;
    });
  });

  return {
    ownerCoverageSummary,
  };
}

async function loadCoverageSummaryDataMap(
  coverageSummaryJson: string
): Promise<CoverageSummaryDataMap> {
  // TODO error handling for readFile
  const coverageSummaryDataMap = JSON.parse(
    await readFile(coverageSummaryJson, "utf-8")
  );

  // TODO verify the data

  return coverageSummaryDataMap as any;
}

main();
