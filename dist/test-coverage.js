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
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        const { pathToCoverageJson, pathToBaselineCoverageJson, output } = (0, yargs_1.default)((0, helpers_1.hideBin)(process.argv))
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
            description: "Output path to write the detailed report to, useful to manually verify the numbers I guess",
        })
            .parseSync();
        const coverageMapData = yield loadCoverageMapData(pathToCoverageJson);
        const baselineCoverageMapData = pathToBaselineCoverageJson
            ? yield loadCoverageMapData(pathToBaselineCoverageJson)
            : undefined;
        const { pathToOwners } = yield (0, lib_1.scanOwners)();
        const gitFiles = yield (0, lib_1.getGitFiles)();
        const { ownerCoverage, ownerCoverageSummary } = yield mapOwnerCoverageInfo({
            coverageMapData,
            pathToOwners,
            gitFiles,
        });
        if (baselineCoverageMapData) {
            // When there's a baseline coverage, we'd sort the table by the highest _difference_
            // in the number of covered statements (not the typical covered statements themselves)
            const { ownerCoverageSummary: baselineOwnerCoverageSummary } = yield mapOwnerCoverageInfo({
                coverageMapData: baselineCoverageMapData,
                pathToOwners,
                gitFiles,
            });
            new console_table_printer_1.Table({
                rows: Object.entries(ownerCoverageSummary)
                    .map(([owner, { totalStatements, coveredStatements, coveredStatementsRatio },]) => {
                    var _a;
                    const baselineCoveredStatements = ((_a = baselineOwnerCoverageSummary[owner]) === null || _a === void 0 ? void 0 : _a.coveredStatements) || 0;
                    return {
                        owner,
                        totalStatements,
                        coveredStatements,
                        changedCoveredStatements: coveredStatements - baselineCoveredStatements,
                        coveredStatementsRatio: (coveredStatementsRatio * 100).toFixed(2) + "%",
                    };
                })
                    .sort((a, b) => b.changedCoveredStatements - a.changedCoveredStatements),
            }).printTable();
        }
        else {
            new console_table_printer_1.Table({
                rows: Object.entries(ownerCoverageSummary)
                    .map(([owner, { totalStatements, coveredStatements, coveredStatementsRatio },]) => ({
                    owner,
                    totalStatements,
                    coveredStatements,
                    coveredStatementsRatio: (coveredStatementsRatio * 100).toFixed(2) + "%",
                }))
                    .sort((a, b) => b.coveredStatements - a.coveredStatements),
            }).printTable();
        }
        if (output) {
            yield (0, promises_1.writeFile)(output, JSON.stringify({
                summarizedOwnerCoverages: ownerCoverageSummary,
                ownerCoveragesMap: ownerCoverage,
            }));
        }
    });
}
function mapOwnerCoverageInfo(_a) {
    return __awaiter(this, arguments, void 0, function* ({ coverageMapData, pathToOwners, gitFiles, }) {
        const ownerCoverage = {};
        const ownerCoverageSummary = {};
        pathToOwners.forEach((owners, path) => {
            if (!gitFiles.has(path)) {
                return;
            }
            if (!owners.length) {
                return;
            }
            // TODO(Minh) this only works with full path. Should be a better way around, e.g. tweak the coverage collection to have relative path?
            const coverage = coverageMapData[lib_1.BASE_DIR + "/" + path];
            if (!coverage) {
                return;
            }
            const totalStatements = Object.keys(coverage.statementMap).length;
            const coveredStatements = Object.values(coverage.s).reduce((coveredLines, thisLine) => coveredLines + (thisLine ? 1 : 0), 0);
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
    });
}
function loadCoverageMapData(pathToCoverageJson) {
    return __awaiter(this, void 0, void 0, function* () {
        // TODO error handling for readFile
        const coverageMapData = JSON.parse(yield (0, promises_1.readFile)(pathToCoverageJson, "utf-8"));
        // TODO verify the data
        return coverageMapData;
    });
}
main();
//# sourceMappingURL=test-coverage.js.map