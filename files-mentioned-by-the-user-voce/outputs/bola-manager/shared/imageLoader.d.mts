export function createImageLoader(options: {
  fetchImage: (url: string, signal: AbortSignal) => Promise<Blob>;
  createUrl: (blob: Blob) => string;
  revokeUrl: (url: string) => void;
  now?: () => number;
  maxEntries?: number;
  maxBytes?: number;
}): { acquire(key: string): { promise: Promise<string | null>; release(): void }; clear(): void };
