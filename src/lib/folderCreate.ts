/**
 * Returns a unique folder name that doesn't collide with any existing sibling
 * names. Tries 'new-folder', then 'new-folder-2', 'new-folder-3', ...
 */
export function generateFolderName(siblingNames: Set<string>): string {
  const stem = 'new-folder';
  if (!siblingNames.has(stem)) return stem;
  let counter = 2;
  while (siblingNames.has(`${stem}-${counter}`)) counter++;
  return `${stem}-${counter}`;
}
