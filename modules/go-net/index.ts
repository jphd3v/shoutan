import { requireOptionalNativeModule } from 'expo';
import type { NetInputs, NetOutputs } from '../../src/go/katago';

interface GoNetNative {
  load(name: string): Promise<null>;
  evaluate(name: string, size: number, planes: Uint8Array, globals: number[], meta: number[] | null): Promise<NetOutputs>;
  totalMemory: number;
}

/** Null where the module isn't built in: on iOS, in tests, in Expo Go. */
const native = requireOptionalNativeModule<GoNetNative>('GoNet');

/** The network the bot plays with, in `android/src/main/assets/nets/`. */
export const BOT_NET = 'kata1-b10c128';

export const netAvailable = native !== null;

/** KataGo's human-style network, which plays like a player of a chosen rank (`src/go/human.ts`). */
export const HUMAN_NET = 'b18c384nbt-humanv0';

/**
 * The human-style network takes a few hundred MB while it runs, so only phones sold with 6 GB or more
 * (they report about 5.5 GB) play it; others get the small network at every level.
 */
export const humanNetAvailable = native !== null && native.totalMemory >= 5e9;

/** Reads the network's file ahead of the first move, so that move doesn't wait for it. */
export const preloadNet = (name: string) => native?.load(name).catch(() => null);

export function evaluateNet(name: string, size: number, inputs: NetInputs, meta?: Float32Array): Promise<NetOutputs> {
  if (!native) return Promise.reject(new Error('The Go network is not in this build'));
  return native.evaluate(name, size, inputs.planes, inputs.globals, meta ? Array.from(meta) : null);
}
