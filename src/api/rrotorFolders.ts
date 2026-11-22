import { useQuery } from '@tanstack/react-query';

/**
 * The one place the browser asks a rrotor itself, at the machine's own address and not through Glyphh: the folders
 * on that machine, for choosing which a bot may use. `GET <rrotor>/v1/folders?under=<path>` answers
 * `{folders: [{path, name}]}`; no `under` is where the machine starts (its home).
 */
export type MachineFolder = { path: string; name: string };

export async function foldersUnder(base: string, under: string): Promise<MachineFolder[]> {
  const url = `${base.replace(/\/+$/, '')}/v1/folders${under ? `?under=${encodeURIComponent(under)}` : ''}`;
  let response: Response;
  try {
    response = await fetch(url, { headers: { accept: 'application/json' } });
  } catch {
    throw new Error('That machine did not answer. Check it is on and linked to Glyphh.');
  }
  if (!response.ok) throw new Error('That machine could not list its folders.');
  const body = (await response.json()) as { folders?: MachineFolder[] };
  return Array.isArray(body.folders) ? body.folders : [];
}

/** The folders under `under` on the rrotor at `base`; asked only while there is an address to ask. */
export const useMachineFolders = (base: string | null | undefined, under: string) =>
  useQuery({
    queryKey: ['rrotor-folders', base ?? '', under],
    queryFn: () => foldersUnder(base!, under),
    enabled: Boolean(base),
    retry: false,
    staleTime: 30_000,
  });
