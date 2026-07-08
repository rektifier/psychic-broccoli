// ─── File and folder CRUD ────────────────────────────────────────────────────
// Create/rename/delete/duplicate operations for .http files and folders in
// the open workspace. Each operation performs the disk change first and only
// updates the tree stores when it succeeds; failures surface as error toasts.

import { get } from 'svelte/store';
import { readTextFile, writeTextFile, rename, remove, mkdir } from '@tauri-apps/plugin-fs';
import { join, basename, dirname } from '@tauri-apps/api/path';
import {
  workspace,
  addToast,
  removeFileFromTree,
  removeFolderFromTree,
  addFileToTree,
  addFolderToTree,
  renameFileInTree,
  renameFolderInTree,
  markFileSaved,
  editingFilePath,
  editingFolderPath,
} from './stores';
import { serializeHttpFile } from './parser';
import { createFileNode, createEmptyFileNode } from './workspaceTree';
import { findFile, findFolder, collectFilePaths } from './tree';
import { errorMessage } from './errors';
import { generateFolderName } from './folderCreate';

export async function deleteFile(filePath: string) {
  try {
    await remove(filePath);
  } catch (err) {
    addToast(`Failed to delete file: ${errorMessage(err)}`, 'error');
    return;
  }

  removeFileFromTree(filePath);
}

export async function deleteFolder(folderPath: string) {
  try {
    await remove(folderPath, { recursive: true });
  } catch (err) {
    addToast(`Failed to delete folder: ${errorMessage(err)}`, 'error');
    return;
  }

  removeFolderFromTree(folderPath);
}

/** Create a new empty .http file in the given folder (workspace root when null). */
export async function createFile(parentFolder: string | null) {
  const ws = get(workspace);
  const rootPath = ws.rootPath;
  if (!rootPath) return;

  const folderPath = parentFolder || rootPath;

  // Generate unique filename
  const stem = 'new-request';
  let fileName = stem + '.http';
  let filePath = await join(folderPath, fileName);
  let counter = 2;

  // Check for collisions in the tree
  const existingNames = new Set(collectFilePaths(ws.tree));

  while (existingNames.has(filePath)) {
    fileName = `${stem}-${counter}.http`;
    filePath = await join(folderPath, fileName);
    counter++;
  }

  const fileNode = createEmptyFileNode(filePath, fileName);
  const content = serializeHttpFile(fileNode.requests, fileNode.variables);

  try {
    await writeTextFile(filePath, content);
  } catch (err) {
    addToast(`Failed to create file: ${errorMessage(err)}`, 'error');
    return;
  }

  fileNode.dirty = false;
  fileNode.savedContent = content;
  addFileToTree(folderPath === rootPath ? null : folderPath, fileNode);
  editingFilePath.set(filePath);
}

/** Create a new folder in the given parent (workspace root when null). */
export async function createFolder(parentFolder: string | null) {
  const ws = get(workspace);
  const rootPath = ws.rootPath;
  if (!rootPath) return;

  const parentDir = parentFolder || rootPath;

  // Collect sibling names in the target parent
  const siblings = new Set<string>();
  if (parentDir === rootPath) {
    for (const n of ws.tree) siblings.add(n.name);
  } else {
    const parent = findFolder(ws.tree, parentDir);
    for (const c of parent?.children ?? []) siblings.add(c.name);
  }

  const folderName = generateFolderName(siblings);
  const folderPath = await join(parentDir, folderName);

  try {
    await mkdir(folderPath, { recursive: true });
  } catch (err) {
    addToast(`Failed to create folder: ${errorMessage(err)}`, 'error');
    return;
  }

  addFolderToTree(parentDir === rootPath ? null : parentDir, {
    type: 'folder',
    name: folderName,
    path: folderPath,
    children: [],
    expanded: true,
  });
  editingFolderPath.set(folderPath);
}

export async function renameFolder(oldPath: string, newName: string) {
  const dir = await dirname(oldPath);
  const newPath = await join(dir, newName);

  try {
    await rename(oldPath, newPath);
  } catch (err) {
    addToast(`Failed to rename folder: ${errorMessage(err)}`, 'error');
    return;
  }

  renameFolderInTree(oldPath, newPath, newName);
  editingFolderPath.set(null);
}

export async function renameFile(oldPath: string, newName: string) {
  // If file is dirty, save first
  const file = findFile(get(workspace).tree, oldPath);
  if (file && file.dirty) {
    try {
      const content = serializeHttpFile(file.requests, file.variables);
      await writeTextFile(oldPath, content);
      markFileSaved(oldPath);
    } catch (err) {
      addToast(`Failed to save file before rename: ${errorMessage(err)}`, 'error');
      return;
    }
  }

  const dir = await dirname(oldPath);
  const newPath = await join(dir, newName);

  try {
    await rename(oldPath, newPath);
  } catch (err) {
    addToast(`Failed to rename file: ${errorMessage(err)}`, 'error');
    return;
  }

  renameFileInTree(oldPath, newPath, newName);
  editingFilePath.set(null);
}

export async function duplicateFile(sourcePath: string) {
  let content: string;
  try {
    content = await readTextFile(sourcePath);
  } catch (err) {
    addToast(`Failed to read file: ${errorMessage(err)}`, 'error');
    return;
  }

  const dir = await dirname(sourcePath);
  const sourceBase = await basename(sourcePath);
  const sourceStem = sourceBase.replace(/\.(http|rest)$/, '');

  // Generate unique copy name
  let copyStem = `${sourceStem} (copy)`;
  let copyName = copyStem + '.http';
  let copyPath = await join(dir, copyName);
  let counter = 2;

  const ws = get(workspace);
  const existingNames = new Set(collectFilePaths(ws.tree));

  while (existingNames.has(copyPath)) {
    copyStem = `${sourceStem} (copy ${counter})`;
    copyName = copyStem + '.http';
    copyPath = await join(dir, copyName);
    counter++;
  }

  try {
    await writeTextFile(copyPath, content);
  } catch (err) {
    addToast(`Failed to duplicate file: ${errorMessage(err)}`, 'error');
    return;
  }

  const fileNode = createFileNode(copyPath, copyName, content);
  const parentPath = dir === ws.rootPath ? null : dir;
  addFileToTree(parentPath, fileNode);
  editingFilePath.set(copyPath);
}

export function cancelRename() {
  editingFilePath.set(null);
  editingFolderPath.set(null);
}
