'use strict';

const MARKER = '---';

/**
 * Build an Obsidian-compatible YAML frontmatter string from a project's index entry.
 * Used when creating vault projects and when syncing after status/milestone changes.
 */
function buildFrontmatter(proj) {
  const milestones = proj.milestones || [];
  const lines = [
    MARKER,
    `title: ${JSON.stringify(proj.name)}`,
    `id: ${proj.id}`,
    `status: ${proj.status}`,
    'tags:',
    '  - project',
    `location: ${proj.location || ''}`,
    `started: ${proj.startDate}`,
    `due: ${proj.dueDate || ''}`,
    `completed: ${proj.completionDate || ''}`,
    `archived: ${proj.archivedDate || ''}`,
    `description: ${JSON.stringify(proj.description || '')}`,
  ];

  if (milestones.length > 0) {
    lines.push('milestones:');
    for (const m of milestones) {
      lines.push(`  - name: ${JSON.stringify(m.name)}`);
      lines.push(`    due: ${m.due}`);
      lines.push(`    completedDate: ${m.completedDate || ''}`);
    }
  } else {
    lines.push('milestones:');
  }

  lines.push(MARKER);
  return lines.join('\n') + '\n';
}

/**
 * Return everything after the closing --- of existing frontmatter.
 * If no frontmatter is present, returns the full content unchanged.
 */
function extractBody(content) {
  if (!content.startsWith(MARKER + '\n')) return content;
  const endIdx = content.indexOf('\n' + MARKER + '\n', MARKER.length);
  if (endIdx === -1) return content;
  return content.slice(endIdx + MARKER.length + 2); // skip \n---\n
}

/**
 * Replace (or prepend) the frontmatter in a README.md string.
 * Rebuilds from the project's current index entry so index is always the source of truth.
 */
function setFrontmatter(content, proj) {
  const body = extractBody(content);
  return buildFrontmatter(proj) + body;
}

module.exports = { buildFrontmatter, extractBody, setFrontmatter };
