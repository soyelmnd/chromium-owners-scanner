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
        const argv = (0, yargs_1.default)((0, helpers_1.hideBin)(process.argv))
            .option('pathToCoverageJson', {
            alias: 'p',
            type: 'string',
            default: 'coverage/coverage-final.json',
            description: 'Path to coverage-final.json'
        })
            .parseSync();
        const pathToCoverageJson = argv.pathToCoverageJson;
        const coverageMapData = yield loadCoverageMapData(pathToCoverageJson);
        const { pathToOwners } = yield (0, lib_1.scanOwners)();
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
                    coveredStatementsRatio: (coveredStatementsRatio * 100).toFixed(2) + "%",
                };
            })
                .sort((a, b) => b.coveredStatements - a.coveredStatements),
        }).printTable();
    });
}
function loadCoverageMapData(pathToCoverageJson) {
    return __awaiter(this, void 0, void 0, function* () {
        const coverageMapData = yield (0, promises_1.readFile)(pathToCoverageJson);
        // TODO error handling for readFile
        // TODO verify the data
        return coverageMapData;
    });
}
main();
//# sourceMappingURL=test-coverage.js.map