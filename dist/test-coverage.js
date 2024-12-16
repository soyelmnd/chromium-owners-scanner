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
Object.defineProperty(exports, "__esModule", { value: true });
const console_table_printer_1 = require("console-table-printer");
const lib_1 = require("./lib");
const jest_1 = require("jest");
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        const { pathToOwners } = yield (0, lib_1.scanOwners)();
        // TODO error handling for the runCLI
        const { results: { coverageMap }, } = yield (0, jest_1.runCLI)({
            coverage: true,
            _: [],
            $0: "",
            silent: true,
        }, [lib_1.BASE_DIR]);
        const coverageMapData = coverageMap === null || coverageMap === void 0 ? void 0 : coverageMap.data;
        if (!coverageMapData) {
            console.log("No coverage hmm - why?");
            return;
        }
        const ownerCoveragesMap = {};
        const summarizedOwnerCoverages = {};
        const gitFiles = yield (0, lib_1.getGitFiles)();
        pathToOwners.forEach((owners, path) => {
            if (!gitFiles.has(path)) {
                return;
            }
            if (!owners.length) {
                return;
            }
            const coverage = coverageMapData[lib_1.BASE_DIR + "/" + path];
            if (!coverage) {
                return;
            }
            const totalStatements = Object.keys(coverage.statementMap).length;
            const coveredStatements = Object.values(coverage.s).reduce((coveredLines, thisLine) => coveredLines + (thisLine ? 1 : 0), 0);
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
        new console_table_printer_1.Table({
            rows: Object.entries(summarizedOwnerCoverages)
                .map(([owner, { totalStatements, coveredStatements, coveredStatementsRatio },]) => {
                return {
                    owner,
                    totalStatements,
                    coveredStatements,
                    coveredStatementsRatio: (coveredStatementsRatio * 100).toFixed(2) + '%',
                };
            })
                .sort((a, b) => b.coveredStatements - a.coveredStatements),
        }).printTable();
    });
}
main();
//# sourceMappingURL=test-coverage.js.map