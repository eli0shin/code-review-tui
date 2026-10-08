import { useEffect, useRef, useState } from 'react';
import type { CurrentRepositoryResult } from '../../github/current-repository.ts';
import type { GitHubRepository } from '../../github/types.ts';

export function useRepositoryScope(
  loadCurrentRepository:
    ((signal: AbortSignal) => Promise<CurrentRepositoryResult>) | undefined
) {
  const [currentRepository, setCurrentRepository] =
    useState<GitHubRepository>();
  const [repositoryScoped, setRepositoryScoped] = useState(false);
  const [diagnostic, setDiagnostic] = useState<string>();
  const [resolving, setResolving] = useState(false);
  const controllerRef = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => controllerRef.current?.abort(), []);

  const repository = repositoryScoped ? currentRepository : undefined;
  const label =
    repository === undefined
      ? 'All repositories'
      : `${repository.hostname === 'github.com' ? '' : `${repository.hostname}/`}${repository.nameWithOwner}`;

  async function toggle(onChanged: () => void): Promise<void> {
    if (controllerRef.current !== undefined) return;
    setDiagnostic(undefined);
    if (currentRepository !== undefined) {
      setRepositoryScoped((current) => !current);
    } else if (loadCurrentRepository === undefined) {
      setDiagnostic(
        'Repository scope requires review to start inside a Git repository.'
      );
      return;
    } else {
      const controller = new AbortController();
      controllerRef.current = controller;
      setResolving(true);
      const result = await loadCurrentRepository(controller.signal);
      if (controller.signal.aborted) return;
      controllerRef.current = undefined;
      setResolving(false);
      if (!result.ok) {
        setDiagnostic(result.diagnostic);
        return;
      }
      setCurrentRepository(result.repository);
      setRepositoryScoped(true);
    }
    onChanged();
  }

  return { repository, label, diagnostic, resolving, toggle };
}
