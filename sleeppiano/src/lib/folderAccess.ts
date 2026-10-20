import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Node reports a Windows ACL denial as EPERM and a POSIX permission-bit denial as EACCES. */
function isPermissionError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === 'EPERM' || code === 'EACCES';
}

/** The account the pipeline runs as, in the DOMAIN\user form icacls resolves unambiguously. */
function accountName(): string {
  const { username } = os.userInfo();
  return process.platform === 'win32' && process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${username}` : username;
}

/** Whether `folder` exists as far as this account can tell, including one it may not open. */
function isPresent(folder: string): boolean {
  if (fs.existsSync(folder)) return true;
  // On Windows stat() has to open the folder itself, which a denying ACL refuses, but the
  // parent's listing still names it. NTFS names are case-insensitive, hence the comparison.
  const name = path.basename(folder).toLowerCase();
  try {
    return fs.readdirSync(path.dirname(folder)).some((entry) => entry.toLowerCase() === name);
  } catch {
    return false;
  }
}

/**
 * The deepest folder on the way up from `dir` that this account can tell exists. Everything
 * below a folder it may not open is invisible to it, so this lands on the folder whose
 * permissions shut it out rather than on the configured leaf. Null at a drive or filesystem
 * root, which is never a sensible thing to take ownership of.
 */
function nearestVisibleFolder(dir: string): string | null {
  let probe = path.resolve(dir);
  while (!isPresent(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) return null;
    probe = parent;
  }
  return path.dirname(probe) === probe ? null : probe;
}

/**
 * A folder from .env that this account cannot write, as an error the run log can act on
 * instead of a bare `EPERM: operation not permitted, mkdir ...`. Anything but a permission
 * denial -- a full disk, a file where a folder should be -- is returned untouched, because
 * the permission hint would send the user the wrong way.
 */
export function explainAccessError(error: unknown, setting: string, dir: string): unknown {
  if (!isPermissionError(error)) return error;

  const account = accountName();
  const reason = error instanceof Error ? error.message : String(error);
  const target = nearestVisibleFolder(dir);

  let fix: string;
  if (target === null) {
    fix = `Point ${setting} in .env at a folder this account can write.`;
  } else if (process.platform === 'win32') {
    // A drive carried over from another Windows install or account keeps ACLs naming the old
    // account's SID, and every folder on it denies the new one until it is granted again.
    fix =
      `The folder's permissions (ACL) most likely leave this account out -- typical of a drive carried over ` +
      `from another Windows install. Grant access once from an Administrator PowerShell: ` +
      `takeown /F "${target}" /A /R /D Y; icacls "${target}" /grant "${account}:(OI)(CI)F" /T /C ` +
      `-- or point ${setting} in .env at a folder this account can write.`;
  } else {
    fix = `Give this account write access to ${target}, or point ${setting} in .env at a folder it can write.`;
  }

  return new Error(`${setting} is not writable by ${account}: ${reason}. ${fix}`, { cause: error });
}

/**
 * Create `dir` if needed and prove this account can write into it, the way the pipeline
 * later will. Throws explainAccessError's result on failure.
 */
export function ensureWritableDir(dir: string, setting: string): void {
  const probe = path.join(dir, `.write-probe-${process.pid}`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(probe, '');
    fs.unlinkSync(probe);
  } catch (error) {
    throw explainAccessError(error, setting, dir);
  }
}
