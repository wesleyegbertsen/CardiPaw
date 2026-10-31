import { cleanUpExports, MAX_EXPORT_AGE_MS } from '../services/nativeFile';
import { isNative } from '../utils/platform';

/**
 * App only: deletes exports older than an hour (MAX_EXPORT_AGE_MS) in the background; never
 * delays or fails the start.
 */
export function cleanUpOldExports(): void {
  if (!isNative()) return;
  void cleanUpExports(MAX_EXPORT_AGE_MS);
}
