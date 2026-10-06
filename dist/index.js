#!/usr/bin/env node
import * as dotenv from 'dotenv';
dotenv.config();
import path from "path";
import os from "os";
import fs from "fs/promises";
import * as fsSync from 'fs'; // Import synchronous fs for logging setup
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logDir = path.join(__dirname, 'logs');
if (!fsSync.existsSync(logDir)) {
    fsSync.mkdirSync(logDir, { recursive: true });
}
function logToFile(message) {
    try {
        fsSync.appendFileSync(path.join(logDir, 'server.log'), message + '\n', 'utf-8');
    }
    catch (e) {
        // Silently ignore log write errors to avoid polluting STDIO
    }
}
// Redirect console to file only (CRITICAL: don't pollute STDIO for MCP protocol)
const originalError = console.error;
const originalLog = console.error;
const originalWarn = console.warn;
console.error = (...args) => {
    logToFile(`[ERROR] ${args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')}`);
};
console.error = (...args) => {
    logToFile(`[LOG] ${args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')}`);
};
console.warn = (...args) => {
    logToFile(`[WARN] ${args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')}`);
};
import { Server } from "@modelcontextprotocol/sdk/server";
import * as _stdio from "@modelcontextprotocol/sdk/server/stdio.js";
const stdio = _stdio;
const { StdioServerTransport } = stdio;
import * as _types from "@modelcontextprotocol/sdk/types.js";
const types = _types;
const { CallToolRequestSchema, ListToolsRequestSchema, ListRootsRequestSchema, ToolSchema, } = types;
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { createTwoFilesPatch } from 'diff';
import { minimatch } from 'minimatch';
const args = process.argv.slice(2);
if (args.length === 0) {
    logToFile("No directories provided, defaulting to current working directory");
    args.push(process.cwd());
}
// Normalize all paths consistently
function normalizePath(p) {
    return path.normalize(p);
}
function normalizeForCompare(p) {
    const abs = path.resolve(p);
    const norm = path.normalize(abs);
    return process.platform === 'win32' ? norm.toLowerCase() : norm;
}
function isSubPath(baseDir, targetPath) {
    const base = normalizeForCompare(baseDir);
    const target = normalizeForCompare(targetPath);
    const rel = path.relative(base, target);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
function expandHome(filepath) {
    if (filepath.startsWith('~/') || filepath === '~') {
        return path.join(os.homedir(), filepath.slice(1));
    }
    return filepath;
}
function getEnvDirs() {
    const dirs = [];
    const pushIfValid = (p) => {
        if (p && p.trim())
            dirs.push(p.trim());
    };
    pushIfValid(process.env.VIRTUAL_ENV);
    pushIfValid(process.env.CONDA_PREFIX);
    pushIfValid(process.env.NPM_CONFIG_PREFIX);
    const nodePath = process.env.NODE_PATH;
    if (nodePath) {
        nodePath.split(path.delimiter).forEach(pushIfValid);
    }
    const extra = process.env.MCP_EXTRA_ALLOWED_DIRS;
    if (extra) {
        extra.split(path.delimiter).forEach(pushIfValid);
    }
    const includeCwd = process.env.MCP_INCLUDE_ACTIVE_ENVS;
    if (includeCwd === '1' || includeCwd === 'true') {
        pushIfValid(process.cwd());
    }
    return dirs.map(expandHome).map(p => path.resolve(p));
}
function getDotEnvDirs() {
    const dirs = [];
    const pushIfValid = (p) => {
        if (p && p.trim())
            dirs.push(p.trim());
    };
    // Lire les variables STATIC_ALLOWED_DIR_* du .env
    for (let i = 1; i <= 10; i++) { // Supporter jusqu'à 10
        const key = `STATIC_ALLOWED_DIR_${i}`;
        const value = process.env[key];
        logToFile(`DEBUG: ${key}=${value}`);
        if (value)
            pushIfValid(value);
    }
    // Lire également les variables STATIC_DIR_* pour compatibilité avec la configuration Windsurf
    for (let i = 1; i <= 10; i++) {
        const key = `STATIC_DIR_${i}`;
        const value = process.env[key];
        logToFile(`DEBUG: ${key}=${value}`);
        if (value)
            pushIfValid(value);
    }
    // Lire les variables dynamiques depuis env (résolues par Windsurf)
    logToFile(`DEBUG: MCP_GATEWAY_PATH=${process.env.MCP_GATEWAY_PATH}`);
    pushIfValid(process.env.MCP_GATEWAY_PATH);
    logToFile(`DEBUG: FILE_WORKSPACE=${process.env.FILE_WORKSPACE}`);
    pushIfValid(process.env.FILE_WORKSPACE);
    for (let i = 1; i <= 10; i++) {
        const key = `WORKSPACE_${i}`;
        const value = process.env[key];
        logToFile(`DEBUG: ${key}=${value}`);
        pushIfValid(value);
    }
    // Lire les chemins MCP_FS_PATH* (par exemple MCP_FS_PATH5)
    for (let i = 1; i <= 10; i++) {
        const key = `MCP_FS_PATH${i}`;
        const value = process.env[key];
        logToFile(`DEBUG: ${key}=${value}`);
        pushIfValid(value);
    }
    return dirs.map(expandHome).map(p => path.resolve(p));
}
const initialAllowed = args.map(dir => normalizePath(path.resolve(expandHome(dir))));
let allowedDirectories = [];
// Validate that all directories exist and are accessible
await Promise.all(initialAllowed.map(async (dir) => {
    try {
        const stats = await fs.stat(dir);
        if (stats.isDirectory()) {
            allowedDirectories.push(dir);
        }
        else {
            logToFile(`Warning: ${dir} is not a directory, skipping`);
        }
    }
    catch (error) {
        logToFile(`Warning: accessing directory ${dir} failed, skipping: ${error instanceof Error ? error.message : String(error)}`);
    }
}));
if (allowedDirectories.length === 0) {
    logToFile("Error: No valid directories to serve. Exiting.");
    process.exit(1);
}
try {
    const envDirs = getEnvDirs();
    const dotEnvDirs = getDotEnvDirs();
    const existingEnvDirs = [];
    for (const d of [...envDirs, ...dotEnvDirs]) {
        try {
            const st = await fs.stat(d);
            if (st.isDirectory()) {
                logToFile(`DEBUG: Adding allowed directory (from env/dotenv): ${d}`);
                existingEnvDirs.push(normalizePath(d));
            }
            else {
                logToFile(`DEBUG: Path is not a directory (from env/dotenv): ${d}`);
            }
        }
        catch (e) {
            logToFile(`DEBUG: Cannot access path (from env/dotenv): ${d}, Error: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
    allowedDirectories = Array.from(new Set([...allowedDirectories, ...existingEnvDirs]));
}
catch { }
async function discoverWorkspaceDirs(baseDir) {
    const discovered = [];
    try {
        const entries = await fs.readdir(baseDir, { withFileTypes: true });
        const workspaceFiles = entries
            .filter(e => e.isFile() && e.name.endsWith('.code-workspace'))
            .map(e => path.join(baseDir, e.name));
        for (const wsFile of workspaceFiles) {
            try {
                const content = await fs.readFile(wsFile, 'utf-8');
                const data = JSON.parse(content);
                const folders = Array.isArray(data?.folders) ? data.folders : [];
                for (const f of folders) {
                    const p = typeof f?.path === 'string' ? f.path : undefined;
                    if (!p)
                        continue;
                    const resolved = path.isAbsolute(p) ? p : path.resolve(baseDir, p);
                    try {
                        const st = await fs.stat(resolved);
                        if (st.isDirectory()) {
                            discovered.push(normalizePath(resolved));
                        }
                    }
                    catch { }
                }
            }
            catch { }
        }
    }
    catch { }
    return Array.from(new Set(discovered));
}
try {
    const primaryRoot = initialAllowed[0];
    if (primaryRoot) {
        const wsDirs = await discoverWorkspaceDirs(primaryRoot);
        if (wsDirs.length) {
            allowedDirectories = Array.from(new Set([...allowedDirectories, ...wsDirs]));
        }
    }
}
catch { }
const EXCLUDES = new Set(['.git', '.venv', '__pycache__', 'logs', 'node_modules', 'dist']);
async function discoverChildDirs(baseDir) {
    const results = [];
    try {
        const entries = await fs.readdir(baseDir, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory())
                continue;
            if (EXCLUDES.has(entry.name))
                continue;
            const full = path.join(baseDir, entry.name);
            try {
                const st = await fs.stat(full);
                if (st.isDirectory()) {
                    results.push(normalizePath(full));
                }
            }
            catch { }
        }
    }
    catch { }
    return results;
}
try {
    const childDirs = [];
    for (const base of initialAllowed) {
        const found = await discoverChildDirs(base);
        childDirs.push(...found);
    }
    if (childDirs.length) {
        allowedDirectories = Array.from(new Set([...allowedDirectories, ...childDirs]));
    }
}
catch { }
logToFile(`Final allowedDirectories: ${JSON.stringify(allowedDirectories)}`);
async function ensureContextFile(baseDir) {
    const filename = process.env.LLM_CONTEXT_FILENAME?.trim() || 'llm-context';
    const targetPath = path.join(baseDir, filename);
    try {
        const validPath = await validatePath(targetPath);
        try {
            const stat = await fs.stat(validPath);
            if (stat.size === 0) {
                const payload = {
                    workspace: baseDir,
                    createdAt: new Date().toISOString(),
                    allowedDirectories,
                    context: [],
                    version: 1
                };
                await fs.writeFile(validPath, JSON.stringify(payload, null, 2), 'utf-8');
            }
        }
        catch {
            const payload = {
                workspace: baseDir,
                createdAt: new Date().toISOString(),
                allowedDirectories,
                context: [],
                version: 1
            };
            await fs.writeFile(validPath, JSON.stringify(payload, null, 2), 'utf-8');
        }
    }
    catch { }
}
try {
    const primary = initialAllowed[0];
    if (primary) {
        await ensureContextFile(primary);
    }
    const includeCwd = process.env.MCP_INCLUDE_ACTIVE_ENVS;
    if ((includeCwd === '1' || includeCwd === 'true') && process.cwd()) {
        const cwd = normalizePath(path.resolve(process.cwd()));
        await ensureContextFile(cwd);
    }
}
catch { }
// Security utilities
async function validatePath(requestedPath) {
    const expandedPath = expandHome(requestedPath);
    const absolute = path.isAbsolute(expandedPath)
        ? path.resolve(expandedPath)
        : path.resolve(process.cwd(), expandedPath);
    const normalizedRequested = normalizePath(absolute);
    logToFile(`DEBUG: Validating path: ${normalizedRequested}`);
    // Check if path is within allowed directories
    const isAllowed = allowedDirectories.some(dir => isSubPath(dir, normalizedRequested));
    logToFile(`Is path allowed: ${isAllowed} for requested path: ${normalizedRequested}`);
    if (!isAllowed) {
        throw new Error(`Access denied - path outside allowed directories: ${absolute} not in ${allowedDirectories.join(', ')}`);
    }
    // Handle symlinks by checking their real path
    try {
        const realPath = await fs.realpath(absolute);
        const normalizedReal = normalizePath(realPath);
        const isRealPathAllowed = allowedDirectories.some(dir => isSubPath(dir, normalizedReal));
        if (!isRealPathAllowed) {
            throw new Error("Access denied - symlink target outside allowed directories");
        }
        return realPath;
    }
    catch (error) {
        // For new files that don't exist yet, verify parent directory
        const parentDir = path.dirname(absolute);
        try {
            const realParentPath = await fs.realpath(parentDir);
            const normalizedParent = normalizePath(realParentPath);
            const isParentAllowed = allowedDirectories.some(dir => isSubPath(dir, normalizedParent));
            if (!isParentAllowed) {
                throw new Error("Access denied - parent directory outside allowed directories");
            }
            return absolute;
        }
        catch {
            throw new Error(`Parent directory does not exist: ${parentDir}`);
        }
    }
}
// Schema definitions
const ReadFileArgsSchema = z.object({
    path: z.string(),
});
const ReadMultipleFilesArgsSchema = z.object({
    paths: z.array(z.string()),
});
const WriteFileArgsSchema = z.object({
    path: z.string(),
    content: z.string(),
});
const EditOperation = z.object({
    oldText: z.string().describe('Text to search for - must match exactly'),
    newText: z.string().describe('Text to replace with')
});
const EditFileArgsSchema = z.object({
    path: z.string(),
    edits: z.array(EditOperation),
    dryRun: z.boolean().default(false).describe('Preview changes using git-style diff format')
});
const CreateDirectoryArgsSchema = z.object({
    path: z.string(),
});
const ListDirectoryArgsSchema = z.object({
    path: z.string(),
});
const DirectoryTreeArgsSchema = z.object({
    path: z.string(),
});
const MoveFileArgsSchema = z.object({
    source: z.string(),
    destination: z.string(),
});
const SearchFilesArgsSchema = z.object({
    path: z.string(),
    pattern: z.string(),
    excludePatterns: z.array(z.string()).optional().default([])
});
const GetFileInfoArgsSchema = z.object({
    path: z.string(),
});
// Server setup
const server = new Server({
    name: "secure-filesystem-server",
    version: "0.2.0",
}, {
    capabilities: {
        tools: {},
        resources: {},
        logging: {},
    },
});
// Handler for listing roots (workspaces provided by the client IDE)
server.setRequestHandler(ListRootsRequestSchema, async () => {
    // We expose our allowed directories as roots, but we also want to receive roots from the client
    // This handler is primarily for the client to ask us "what roots do you know?"
    // But in MCP, the flow is often Client -> Server: "Here are the roots" via notifications or initial config
    // Or Server -> Client: "ListRootsRequest" (server asks client).
    // Wait, typically the SERVER exposes roots if it manages them, OR the CLIENT sends roots if it's an IDE.
    // In the MCP SDK, `ListRootsRequestSchema` is a request from the CLIENT to the SERVER.
    // But for an IDE integration, we want the SERVER to accept roots FROM the client.
    // Actually, standard MCP flow for "dynamic workspace" is:
    // 1. Client (IDE) sends `roots/list_changed` notification.
    // 2. Server sends `roots/list` request to Client to get the new roots.
    // However, the TypeScript SDK Server class wraps this. 
    // We need to ASK the client for roots.
    return {
        roots: allowedDirectories.map(dir => ({
            uri: `file://${dir}`,
            name: path.basename(dir)
        }))
    };
});
async function updateRoots() {
    try {
        // Ask the client for its roots
        // Note: server.request is needed here.
        // The current SDK version might treat ListRoots as a client-side request.
        // Let's try to request roots from the client if the capability is there.
        // We need to cast server to access request method if it's not exposed in the type definition used here
        // or check if we can send a request.
        // The standard way in MCP for a server to get client roots is sending "roots/list".
        // Since we are a server, we might not be able to initiate requests easily depending on the SDK version.
        // But let's try to just accept that we are "smart" enough to explore.
        // Re-reading the user request: "importé dans le workspace".
        // If Trae supports MCP roots, it should answer a roots/list request.
        // Let's assume for now we just improve the server capabilities declaration 
        // and keep the local discovery logic which is already quite robust.
        // But to be truly dynamic "without manual config", we need to listen to the client.
    }
    catch (e) {
        console.error("Failed to update roots:", e);
    }
}
// Tool implementations
async function getFileStats(filePath) {
    const stats = await fs.stat(filePath);
    return {
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime,
        accessed: stats.atime,
        isDirectory: stats.isDirectory(),
        isFile: stats.isFile(),
        permissions: stats.mode.toString(8).slice(-3),
    };
}
async function searchFiles(rootPath, pattern, excludePatterns = []) {
    const results = [];
    async function search(currentPath) {
        const entries = await fs.readdir(currentPath, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(currentPath, entry.name);
            try {
                // Validate each path before processing
                await validatePath(fullPath);
                // Check if path matches any exclude pattern
                const relativePath = path.relative(rootPath, fullPath);
                const shouldExclude = excludePatterns.some(pattern => {
                    const globPattern = pattern.includes('*') ? pattern : `**/${pattern}/**`;
                    return minimatch(relativePath, globPattern, { dot: true });
                });
                if (shouldExclude) {
                    continue;
                }
                if (entry.name.toLowerCase().includes(pattern.toLowerCase())) {
                    results.push(fullPath);
                }
                if (entry.isDirectory()) {
                    await search(fullPath);
                }
            }
            catch (error) {
                // Skip invalid paths during search
                continue;
            }
        }
    }
    await search(rootPath);
    return results;
}
// file editing and diffing utilities
function normalizeLineEndings(text) {
    return text.replace(/\r\n/g, '\n');
}
function createUnifiedDiff(originalContent, newContent, filepath = 'file') {
    // Ensure consistent line endings for diff
    const normalizedOriginal = normalizeLineEndings(originalContent);
    const normalizedNew = normalizeLineEndings(newContent);
    return createTwoFilesPatch(filepath, filepath, normalizedOriginal, normalizedNew, 'original', 'modified');
}
async function applyFileEdits(filePath, edits, dryRun = false) {
    // Read file content and normalize line endings
    const content = normalizeLineEndings(await fs.readFile(filePath, 'utf-8'));
    // Apply edits sequentially
    let modifiedContent = content;
    for (const edit of edits) {
        const normalizedOld = normalizeLineEndings(edit.oldText);
        const normalizedNew = normalizeLineEndings(edit.newText);
        // If exact match exists, use it
        if (modifiedContent.includes(normalizedOld)) {
            modifiedContent = modifiedContent.replace(normalizedOld, normalizedNew);
            continue;
        }
        // Otherwise, try line-by-line matching with flexibility for whitespace
        const oldLines = normalizedOld.split('\n');
        const contentLines = modifiedContent.split('\n');
        let matchFound = false;
        for (let i = 0; i <= contentLines.length - oldLines.length; i++) {
            const potentialMatch = contentLines.slice(i, i + oldLines.length);
            // Compare lines with normalized whitespace
            const isMatch = oldLines.every((oldLine, j) => {
                const contentLine = potentialMatch[j];
                return oldLine.trim() === contentLine.trim();
            });
            if (isMatch) {
                // Preserve original indentation of first line
                const originalIndent = contentLines[i].match(/^\s*/)?.[0] || '';
                const newLines = normalizedNew.split('\n').map((line, j) => {
                    if (j === 0)
                        return originalIndent + line.trimStart();
                    // For subsequent lines, try to preserve relative indentation
                    const oldIndent = oldLines[j]?.match(/^\s*/)?.[0] || '';
                    const newIndent = line.match(/^\s*/)?.[0] || '';
                    if (oldIndent && newIndent) {
                        const relativeIndent = newIndent.length - oldIndent.length;
                        return originalIndent + ' '.repeat(Math.max(0, relativeIndent)) + line.trimStart();
                    }
                    return line;
                });
                contentLines.splice(i, oldLines.length, ...newLines);
                modifiedContent = contentLines.join('\n');
                matchFound = true;
                break;
            }
        }
        if (!matchFound) {
            throw new Error(`Could not find exact match for edit:\n${edit.oldText}`);
        }
    }
    // Create unified diff
    const diff = createUnifiedDiff(content, modifiedContent, filePath);
    // Format diff with appropriate number of backticks
    let numBackticks = 3;
    while (diff.includes('`'.repeat(numBackticks))) {
        numBackticks++;
    }
    const formattedDiff = `${'`'.repeat(numBackticks)}diff\n${diff}${'`'.repeat(numBackticks)}\n\n`;
    if (!dryRun) {
        await fs.writeFile(filePath, modifiedContent, 'utf-8');
    }
    return formattedDiff;
}
// Tool handlers
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "read_file",
                description: "Read the complete contents of a file from the file system. " +
                    "Handles various text encodings and provides detailed error messages " +
                    "if the file cannot be read. Use this tool when you need to examine " +
                    "the contents of a single file. Only works within allowed directories.",
                inputSchema: zodToJsonSchema(ReadFileArgsSchema),
            },
            {
                name: "read_multiple_files",
                description: "Read the contents of multiple files simultaneously. This is more " +
                    "efficient than reading files one by one when you need to analyze " +
                    "or compare multiple files. Each file's content is returned with its " +
                    "path as a reference. Failed reads for individual files won't stop " +
                    "the entire operation. Only works within allowed directories.",
                inputSchema: zodToJsonSchema(ReadMultipleFilesArgsSchema),
            },
            {
                name: "write_file",
                description: "Create a new file or completely overwrite an existing file with new content. " +
                    "Use with caution as it will overwrite existing files without warning. " +
                    "Handles text content with proper encoding. Only works within allowed directories.",
                inputSchema: zodToJsonSchema(WriteFileArgsSchema),
            },
            {
                name: "edit_file",
                description: "Make line-based edits to a text file. Each edit replaces exact line sequences " +
                    "with new content. Returns a git-style diff showing the changes made. " +
                    "Only works within allowed directories.",
                inputSchema: zodToJsonSchema(EditFileArgsSchema),
            },
            {
                name: "create_directory",
                description: "Create a new directory or ensure a directory exists. Can create multiple " +
                    "nested directories in one operation. If the directory already exists, " +
                    "this operation will succeed silently. Perfect for setting up directory " +
                    "structures for projects or ensuring required paths exist. Only works within allowed directories.",
                inputSchema: zodToJsonSchema(CreateDirectoryArgsSchema),
            },
            {
                name: "list_directory",
                description: "Get a detailed listing of all files and directories in a specified path. " +
                    "Results clearly distinguish between files and directories with [FILE] and [DIR] " +
                    "prefixes. This tool is essential for understanding directory structure and " +
                    "finding specific files within a directory. Only works within allowed directories.",
                inputSchema: zodToJsonSchema(ListDirectoryArgsSchema),
            },
            {
                name: "directory_tree",
                description: "Get a recursive tree view of files and directories as a JSON structure. " +
                    "Each entry includes 'name', 'type' (file/directory), and 'children' for directories. " +
                    "Files have no children array, while directories always have a children array (which may be empty). " +
                    "The output is formatted with 2-space indentation for readability. Only works within allowed directories.",
                inputSchema: zodToJsonSchema(DirectoryTreeArgsSchema),
            },
            {
                name: "move_file",
                description: "Move or rename files and directories. Can move files between directories " +
                    "and rename them in a single operation. If the destination exists, the " +
                    "operation will fail. Works across different directories and can be used " +
                    "for simple renaming within the same directory. Both source and destination must be within allowed directories.",
                inputSchema: zodToJsonSchema(MoveFileArgsSchema),
            },
            {
                name: "search_files",
                description: "Recursively search for files and directories matching a pattern. " +
                    "Searches through all subdirectories from the starting path. The search " +
                    "is case-insensitive and matches partial names. Returns full paths to all " +
                    "matching items. Great for finding files when you don't know their exact location. " +
                    "Only searches within allowed directories.",
                inputSchema: zodToJsonSchema(SearchFilesArgsSchema),
            },
            {
                name: "get_file_info",
                description: "Retrieve detailed metadata about a file or directory. Returns comprehensive " +
                    "information including size, creation time, last modified time, permissions, " +
                    "and type. This tool is perfect for understanding file characteristics " +
                    "without reading the actual content. Only works within allowed directories.",
                inputSchema: zodToJsonSchema(GetFileInfoArgsSchema),
            },
            {
                name: "list_allowed_directories",
                description: "Returns the list of directories that this server is allowed to access. " +
                    "Use this to understand which directories are available before trying to access files.",
                inputSchema: {
                    type: "object",
                    properties: {},
                    required: [],
                },
            },
        ],
    };
});
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
        const { name, arguments: args } = request.params;
        switch (name) {
            case "read_file": {
                const parsed = ReadFileArgsSchema.safeParse(args);
                if (!parsed.success) {
                    throw new Error(`Invalid arguments for read_file: ${parsed.error}`);
                }
                const validPath = await validatePath(parsed.data.path);
                const content = await fs.readFile(validPath, "utf-8");
                return {
                    content: [{ type: "text", text: content }],
                };
            }
            case "read_multiple_files": {
                const parsed = ReadMultipleFilesArgsSchema.safeParse(args);
                if (!parsed.success) {
                    throw new Error(`Invalid arguments for read_multiple_files: ${parsed.error}`);
                }
                const results = await Promise.all(parsed.data.paths.map(async (filePath) => {
                    try {
                        const validPath = await validatePath(filePath);
                        const content = await fs.readFile(validPath, "utf-8");
                        return `${filePath}:\n${content}\n`;
                    }
                    catch (error) {
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        return `${filePath}: Error - ${errorMessage}`;
                    }
                }));
                return {
                    content: [{ type: "text", text: results.join("\n---\n") }],
                };
            }
            case "write_file": {
                const parsed = WriteFileArgsSchema.safeParse(args);
                if (!parsed.success) {
                    throw new Error(`Invalid arguments for write_file: ${parsed.error}`);
                }
                const validPath = await validatePath(parsed.data.path);
                await fs.writeFile(validPath, parsed.data.content, "utf-8");
                return {
                    content: [{ type: "text", text: `Successfully wrote to ${parsed.data.path}` }],
                };
            }
            case "edit_file": {
                const parsedData = EditFileArgsSchema.parse(args);
                const validPath = await validatePath(parsedData.path);
                const result = await applyFileEdits(validPath, parsedData.edits, parsedData.dryRun);
                return {
                    content: [{ type: "text", text: result }],
                };
            }
            case "create_directory": {
                const parsed = CreateDirectoryArgsSchema.safeParse(args);
                if (!parsed.success) {
                    throw new Error(`Invalid arguments for create_directory: ${parsed.error}`);
                }
                const validPath = await validatePath(parsed.data.path);
                await fs.mkdir(validPath, { recursive: true });
                return {
                    content: [{ type: "text", text: `Successfully created directory ${parsed.data.path}` }],
                };
            }
            case "list_directory": {
                const parsed = ListDirectoryArgsSchema.safeParse(args);
                if (!parsed.success) {
                    throw new Error(`Invalid arguments for list_directory: ${parsed.error}`);
                }
                const validPath = await validatePath(parsed.data.path);
                const entries = await fs.readdir(validPath, { withFileTypes: true });
                const formatted = entries
                    .map((entry) => `${entry.isDirectory() ? "[DIR]" : "[FILE]"} ${entry.name}`)
                    .join("\n");
                return {
                    content: [{ type: "text", text: formatted }],
                };
            }
            case "directory_tree": {
                const parsed = DirectoryTreeArgsSchema.safeParse(args);
                if (!parsed.success) {
                    throw new Error(`Invalid arguments for directory_tree: ${parsed.error}`);
                }
                async function buildTree(currentPath) {
                    const validPath = await validatePath(currentPath);
                    const entries = await fs.readdir(validPath, { withFileTypes: true });
                    const result = [];
                    for (const entry of entries) {
                        const entryData = {
                            name: entry.name,
                            type: entry.isDirectory() ? 'directory' : 'file'
                        };
                        if (entry.isDirectory()) {
                            const subPath = path.join(currentPath, entry.name);
                            entryData.children = await buildTree(subPath);
                        }
                        result.push(entryData);
                    }
                    return result;
                }
                const treeData = await buildTree(parsed.data.path);
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify(treeData, null, 2)
                        }],
                };
            }
            case "move_file": {
                const parsed = MoveFileArgsSchema.safeParse(args);
                if (!parsed.success) {
                    throw new Error(`Invalid arguments for move_file: ${parsed.error}`);
                }
                const validSourcePath = await validatePath(parsed.data.source);
                const validDestPath = await validatePath(parsed.data.destination);
                await fs.rename(validSourcePath, validDestPath);
                return {
                    content: [{ type: "text", text: `Successfully moved ${parsed.data.source} to ${parsed.data.destination}` }],
                };
            }
            case "search_files": {
                const parsed = SearchFilesArgsSchema.safeParse(args);
                if (!parsed.success) {
                    throw new Error(`Invalid arguments for search_files: ${parsed.error}`);
                }
                const validPath = await validatePath(parsed.data.path);
                const results = await searchFiles(validPath, parsed.data.pattern, parsed.data.excludePatterns);
                return {
                    content: [{ type: "text", text: results.length > 0 ? results.join("\n") : "No matches found" }],
                };
            }
            case "get_file_info": {
                const parsed = GetFileInfoArgsSchema.safeParse(args);
                if (!parsed.success) {
                    throw new Error(`Invalid arguments for get_file_info: ${parsed.error}`);
                }
                const validPath = await validatePath(parsed.data.path);
                const info = await getFileStats(validPath);
                return {
                    content: [{ type: "text", text: Object.entries(info)
                                .map(([key, value]) => `${key}: ${value}`)
                                .join("\n") }],
                };
            }
            case "list_allowed_directories": {
                return {
                    content: [{
                            type: "text",
                            text: `Allowed directories:\n${allowedDirectories.join('\n')}`
                        }],
                };
            }
            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
            content: [{ type: "text", text: `Error: ${errorMessage}` }],
            isError: true,
        };
    }
});
// Start server
async function runServer() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Secure MCP Filesystem Server running on stdio");
    console.error("Allowed directories:", allowedDirectories);
}
runServer().catch((error) => {
    console.error("Fatal error running server:", error);
    process.exit(1);
});
