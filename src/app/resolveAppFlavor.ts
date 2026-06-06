import { getPlatformCapabilities } from '../utils/platform';

export type AppFlavor = 'standard' | 'apple-safari';

export function resolveAppFlavor(
  capabilities: Pick<ReturnType<typeof getPlatformCapabilities>, 'isIosSafari'> = getPlatformCapabilities(),
): AppFlavor {
  return capabilities.isIosSafari ? 'apple-safari' : 'standard';
}