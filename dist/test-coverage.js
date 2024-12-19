#!/usr/bin/env node
"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const console_table_printer_1 = require("console-table-printer");
const lib_1 = require("./lib");
const promises_1 = require("fs/promises");
const yargs_1 = __importDefault(require("yargs"));
const helpers_1 = require("yargs/helpers");
// TODO(Minh) correct the naming of these lazy little helper variables
const types = ["statements", "lines", "functions", "branches"];
const props = ["total", "covered", "skipped"];
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        const { coverageSummaryJson, baselineCoverageSummaryJson, output } = (0, yargs_1.default)((0, helpers_1.hideBin)(process.argv))
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
        const coverageSummaryDataMap = yield loadCoverageSummaryDataMap(coverageSummaryJson);
        const { pathToOwners } = yield (0, lib_1.scanOwners)();
        const gitFiles = yield (0, lib_1.getGitFiles)();
        const { ownerCoverageSummary } = yield mapOwnerCoverageInfo({
            coverageSummaryDataMap,
            pathToOwners,
            gitFiles,
        });
        const columns = [
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
            const baselineCoverageSummaryDataMap = yield loadCoverageSummaryDataMap(baselineCoverageSummaryJson);
            const { ownerCoverageSummary: baselineOwnerCoverageSummary } = yield mapOwnerCoverageInfo({
                coverageSummaryDataMap: baselineCoverageSummaryDataMap,
                pathToOwners,
                gitFiles,
            });
            sortedReportRows.forEach((row) => {
                var _a;
                const baselineCoveredStatements = ((_a = baselineOwnerCoverageSummary[row.owner]) === null || _a === void 0 ? void 0 : _a.statements.covered) || 0;
                row.diffCoveredStatements =
                    row._coveredStatementsCount - baselineCoveredStatements;
            });
            sortedReportRows.sort((a, b) => {
                if (b.diffCoveredStatements !== a.diffCoveredStatements) {
                    return b.diffCoveredStatements - a.diffCoveredStatements;
                }
                return b._coveredStatementsCount - a._coveredStatementsCount;
            });
        }
        else {
            disabledColumns.push("diffCoveredStatements");
        }
        const reportTable = new console_table_printer_1.Table({ columns, disabledColumns });
        reportTable.addRows(sortedReportRows);
        reportTable.printTable();
    });
}
function mapOwnerCoverageInfo(_a) {
    return __awaiter(this, arguments, void 0, function* ({ coverageSummaryDataMap, pathToOwners, gitFiles, }) {
        const ownerCoverageSummary = {};
        pathToOwners.forEach((owners, path) => {
            if (!gitFiles.has(path)) {
                return;
            }
            if (!owners.length) {
                return;
            }
            // TODO(Minh) this only works with full path. Should be a better way around, e.g. tweak the coverage collection to have relative path?
            const coverage = coverageSummaryDataMap[lib_1.BASE_DIR + "/" + path];
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
                    Math.round(10000 * (perOwner[type].covered / perOwner[type].total || 0)) / 100;
            });
        });
        return {
            ownerCoverageSummary,
        };
    });
}
function loadCoverageSummaryDataMap(coverageSummaryJson) {
    return __awaiter(this, void 0, void 0, function* () {
        // TODO error handling for readFile
        const coverageSummaryDataMap = JSON.parse(yield (0, promises_1.readFile)(coverageSummaryJson, "utf-8"));
        // TODO verify the data
        return coverageSummaryDataMap;
    });
}
main();
//# sourceMappingURL=test-coverage.js.map