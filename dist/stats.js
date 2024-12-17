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
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        const { pathToOwners } = yield (0, lib_1.scanOwners)();
        const filesTable = new console_table_printer_1.Table({
            columns: [
                { name: "path", alignment: "left", title: "File" },
                { name: "owners", alignment: "right", title: "Owners" },
            ],
        });
        const unownedFiles = [];
        const ownersStats = {};
        const fileStats = {
            filesCount: 0,
            filesOwnedCount: 0,
        };
        // It is actually a { [coownersCount: number]: number } map. Sorry for abusing array :grimacing:
        const coownersCountMap = [];
        const gitFiles = yield (0, lib_1.getGitFiles)();
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
        new console_table_printer_1.Table({
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
            const coownersCountTable = new console_table_printer_1.Table();
            coownersCountMap.forEach((filesCount, coownersCount) => {
                let color;
                if (coownersCount < 2) {
                    color = "red";
                }
                else if (coownersCount > 3) {
                    color = "yellow";
                }
                coownersCountTable.addRow({
                    ["Number of co-owners per file"]: coownersCount,
                    ["Number of files"]: filesCount,
                }, {
                    color,
                });
            });
            coownersCountTable.printTable();
        }
        // Printing unowned paths
        new console_table_printer_1.Table({
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
        new console_table_printer_1.Table()
            .addRow({ Stats: "Total files", Value: fileStats.filesCount }, { color: "green" })
            .addRow({ Stats: "Files with owners", Value: fileStats.filesOwnedCount })
            .addRow({
            Stats: "Files with owners (%)",
            Value: percentage(fileStats.filesOwnedCount, fileStats.filesCount),
        })
            .printTable();
    });
}
function percentage(x, total) {
    return ((x / total) * 100).toFixed(2) + "%";
}
main();
//# sourceMappingURL=stats.js.map