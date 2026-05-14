import * as path from "path";

const COMPUTER_PROJECT_WORKSPACE_SEGMENT = "computer-project-workspace";

function pathEndsWithSegments(candidate: string, suffixSegments: string[]) {
  const candidateSegments = path
    .normalize(candidate)
    .split(path.sep)
    .filter(Boolean);
  if (candidateSegments.length < suffixSegments.length) return false;

  const offset = candidateSegments.length - suffixSegments.length;
  return suffixSegments.every(
    (segment, index) => candidateSegments[offset + index] === segment,
  );
}

export function resolveComputerProjectWorkspaceDir(
  baseWorkspaceDir: string,
  userId: string,
  projectId: string,
): string {
  const normalizedBase = path.normalize(baseWorkspaceDir);
  const suffixSegments = [
    COMPUTER_PROJECT_WORKSPACE_SEGMENT,
    userId,
    projectId,
  ];

  if (pathEndsWithSegments(normalizedBase, suffixSegments)) {
    return normalizedBase;
  }

  return path.join(normalizedBase, ...suffixSegments);
}
