import { cleanUpExports } from '../services/nativeFile';
import { isNative } from '../utils/platform';

/**
 * Exports younger than this are kept at start-up: the app they were shared to may still be
 * reading one (Android can stop CardiPaw meanwhile, say while Drive uploads it).
 */
const MAX_EXPORT_AGE_MS = 60 * 60 * 1000;

/** App only: deletes old exports in the background; never delays or fails the start. */
export function cleanUpOldExports(): void {
  if (!isNative()) return;
  void cleanUpExports(MAX_EXPORT_AGE_MS);
}
