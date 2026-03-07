import fs from 'fs';
import path from 'path';

import { GROUPS_DIR } from './config.js';
import { isValidGroupFolder } from './group-folder.js';
import { logger } from './logger.js';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const CLEANUP_SUBDIRS = ['images', 'outbox'];

/**
 * Delete files older than maxAgeMs from all group images/ and outbox/ directories.
 * Respects .keep markers — files with a companion <filename>.keep are skipped.
 * Returns the number of files deleted.
 */
export function cleanupOldFiles(maxAgeMs = THIRTY_DAYS_MS): number {
  const cutoff = Date.now() - maxAgeMs;
  let deleted = 0;

  let groupFolders: string[];
  try {
    groupFolders = fs.readdirSync(GROUPS_DIR);
  } catch {
    // groups/ dir doesn't exist yet — nothing to clean up
    return 0;
  }

  for (const folder of groupFolders) {
    if (!isValidGroupFolder(folder)) continue;

    for (const subdir of CLEANUP_SUBDIRS) {
      const dir = path.join(GROUPS_DIR, folder, subdir);

      let files: string[];
      try {
        files = fs.readdirSync(dir);
      } catch {
        continue;
      }

      for (const file of files) {
        // Skip .keep marker files themselves
        if (file.endsWith('.keep')) continue;

        const filePath = path.join(dir, file);

        // Respect .keep markers — if <filename>.keep exists, skip this file
        if (fs.existsSync(filePath + '.keep')) continue;

        let stat: fs.Stats;
        try {
          stat = fs.statSync(filePath);
        } catch {
          continue;
        }

        if (!stat.isFile()) continue;

        if (stat.mtimeMs < cutoff) {
          try {
            fs.unlinkSync(filePath);
            logger.info(
              {
                group: folder,
                subdir,
                file,
                agedays: Math.floor((Date.now() - stat.mtimeMs) / 86400000),
              },
              'Deleted old file',
            );
            deleted++;
          } catch (err) {
            logger.warn({ group: folder, subdir, file, err }, 'Failed to delete old file');
          }
        }
      }
    }
  }

  if (deleted > 0) {
    logger.info({ deleted }, 'File cleanup complete');
  } else {
    logger.debug('File cleanup: no files to delete');
  }

  return deleted;
}

/**
 * Start a weekly interval that deletes files older than 30 days from images/ and outbox/ dirs.
 * @returns Timer ID that can be cleared with clearInterval()
 */
export function startFileCleanup(): NodeJS.Timeout {
  // Run once at startup (catches any backlog), then weekly
  cleanupOldFiles();

  return setInterval(() => {
    cleanupOldFiles();
  }, SEVEN_DAYS_MS);
}
