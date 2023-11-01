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
const util_1 = require("util");
const child_process_1 = require("child_process");
const promises_1 = require("fs/promises");
const fs_1 = require("fs");
const path_1 = require("path");
const console_table_printer_1 = require("console-table-printer");
const exec = (0, util_1.promisify)(child_process_1.exec);
const OWNERS_FILE_NAME = "OWNERS";
// TODO error handling
// TODO tests and code split
// TODO subcommand to not list everything at once
// TODO refactor IGNORING_RGX to be configurable esp when this is not a git repo
// TODO auto set git repo root as the BASE_DIR
const BASE_DIR = process.cwd();
const IGNORING_RGX = new RegExp("(?:" +
    ["^./", ".git", "node_modules", `${OWNERS_FILE_NAME}$`].join("|") +
    ")");
function scanOwners() {
    return __awaiter(this, void 0, void 0, function* () {
        const pathToOwners = new Map();
        // Scan all files and folders inside
        yield walkInto([], []);
        return {
            pathToOwners,
        };
        /**
         * Walk the directory tree in DFS
         */
        function walkInto(pathSegments, parentOwnerNodes) {
            return __awaiter(this, void 0, void 0, function* () {
                // A trailing / should help tell us this is a folder at a glance
                const path = (0, path_1.join)(...pathSegments) + "/";
                const currentOwnersNode = parseOwnersFile(path);
                const mergedOwnerNode = mergeOwnersNodes(currentOwnersNode, parentOwnerNodes);
                if (!IGNORING_RGX.test(path)) {
                    pathToOwners.set(path, mergedOwnerNode.owners);
                }
                const ownersNodes = currentOwnersNode
                    ? [currentOwnersNode, ...parentOwnerNodes]
                    : parentOwnerNodes;
                const childrenNodes = yield (0, promises_1.readdir)((0, path_1.join)(BASE_DIR, ...pathSegments), {
                    withFileTypes: true,
                });
                for (const childNode of childrenNodes) {
                    const isDir = childNode.isDirectory();
                    const childNodeName = childNode.name;
                    const childNodePathSegments = [...pathSegments, childNodeName];
                    const childNodePath = (0, path_1.join)(...childNodePathSegments);
                    if (isDir) {
                        yield walkInto(childNodePathSegments, ownersNodes);
                        continue;
                    }
                    if (IGNORING_RGX.test(childNodePath)) {
                        continue;
                    }
                    let perFileOwnersApplied = false;
                    for (const [perFilePattern, perFileNode] of mergedOwnerNode.perFile) {
                        if (matchPattern(perFilePattern, childNodeName)) {
                            pathToOwners.set(childNodePath, perFileNode.owners);
                            perFileOwnersApplied = true;
                            break;
                        }
                    }
                    if (!perFileOwnersApplied) {
                        pathToOwners.set(childNodePath, mergedOwnerNode.owners);
                    }
                }
            });
        }
    });
}
function matchPattern(pattern, nodeName) {
    if (pattern.includes("*")) {
        const rgx = new RegExp(pattern.replace(/\*/g, "(?:.+?)"));
        return rgx.test(nodeName);
    }
    return pattern === nodeName;
}
function mergeOwnersNodes(currentOwnersNode, parentOwnerNodes) {
    const owners = [];
    const ownersNodes = currentOwnersNode != null
        ? [currentOwnersNode, ...parentOwnerNodes]
        : parentOwnerNodes;
    for (const ownersNode of ownersNodes) {
        owners.push(...ownersNode.owners);
        if (ownersNode.noParent) {
            break;
        }
    }
    // Please note the perFile rules do not propagate to descendant folders
    const perFile = new Map();
    if (currentOwnersNode) {
        for (const [perFilePattern, perFileNode] of currentOwnersNode.perFile) {
            perFile.set(perFilePattern, {
                noParent: true,
                owners: uniqueArray([...perFileNode.owners, ...owners]),
            });
        }
    }
    return {
        noParent: true,
        owners: uniqueArray(owners),
        perFile,
    };
}
/**
 * @param path path to the directory or the OWNERS file itself
 * @returns
 */
function parseOwnersFile(path) {
    const pathSegments = [BASE_DIR, path];
    if (!path.endsWith(OWNERS_FILE_NAME)) {
        pathSegments.push(OWNERS_FILE_NAME);
    }
    const ownersFullPath = (0, path_1.join)(...pathSegments);
    if (!(0, fs_1.existsSync)(ownersFullPath)) {
        return;
    }
    const lines = loadFile(ownersFullPath);
    // Including other files
    // Note: this _can_ cause an infinite loop
    for (const line of lines) {
        const matches = line.match(/^(include\s+|file:)(.+)/);
        if (!matches) {
            continue;
        }
        if (!line.endsWith(OWNERS_FILE_NAME)) {
            throw new Error(`Invalid include syntax: "${line}" should point to an OWNERS file`);
        }
        const [_wholeMatch, directive, includePath] = matches;
        // The file: directive would skip per-file and `set noparent` rules
        const skipImplicitGrant = directive === "file:";
        const includeFullPath = includePath.startsWith("/")
            ? (0, path_1.join)(BASE_DIR, includePath)
            : (0, path_1.join)(BASE_DIR, path, includePath);
        const includeLines = loadFile(includeFullPath);
        const filteredIncludeLines = skipImplicitGrant
            ? includeLines.filter((line) => !/^(?:per-file|set noparent)\b/.test(line))
            : includeLines;
        lines.push(...filteredIncludeLines);
    }
    const noParent = lines.includes("set noparent");
    const owners = lines.filter((line) => !/^(?:include\b|file:|per-file\b|set noparent\b|[*#])/.test(line));
    const perFile = new Map();
    const perFileLines = lines.filter((line) => /^per-file\s/.test(line));
    perFileLines.forEach((perFileLine) => {
        const matches = perFileLine.match(/per-file\s+(.+?)\s*=\s*(.+)/);
        if (!matches) {
            return;
        }
        const [_wholeMatch, perFilePatterns, perFileDirective] = matches;
        perFilePatterns.split(/\s*,\s*/).forEach((perFilePattern) => {
            // TODO per-file does not support `set noparent` yet
            // TODO per-file does not support `file` yet
            const perFileOwners = perFileDirective === "*" ? [] : perFileDirective.split(/,/g);
            perFile.set(perFilePattern, {
                noParent: false,
                owners: uniqueArray([...perFileOwners, ...owners]),
            });
        });
    });
    return {
        noParent,
        owners,
        perFile,
    };
}
function loadFile(fullPath) {
    return splitLines((0, fs_1.readFileSync)(fullPath, "utf8"));
}
function splitLines(text) {
    return text.trim().split(/\s*\n+\s*/);
}
function uniqueArray(items) {
    return [...new Set(items)];
}
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        const { pathToOwners } = yield scanOwners();
        const filesTable = new console_table_printer_1.Table({
            columns: [
                { name: "path", alignment: "left", title: "File" },
                { name: "owners", alignment: "right", title: "Owners" },
            ],
        });
        const unownedFiles = [];
        const ownersStats = {};
        const { stdout: gitLsFilesOutput } = yield exec(`cd ${BASE_DIR}; git ls-files`);
        const gitFiles = new Set(splitLines(gitLsFilesOutput));
        const fileStats = {
            filesCount: 0,
            filesOwnedCount: 0,
        };
        // It is actually a { [coownersCount: number]: number } map. Sorry for abusing array :grimacing:
        const coownersCountMap = [];
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
//# sourceMappingURL=index.js.map