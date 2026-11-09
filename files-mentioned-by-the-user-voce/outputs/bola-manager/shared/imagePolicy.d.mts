export const IMAGE_CSP: string;
export const HTTP_CSP: string;
export const MAX_IMAGE_BYTES: number;
export const MAX_IMAGE_DIMENSION: number;
export const MAX_IMAGE_PIXELS: number;
export function allowedDesktopImage(value: unknown, currentOrigin: unknown): string | null;
export function allowedExternalImage(value: unknown): string | null;
