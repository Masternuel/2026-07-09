import sharp from "sharp";

export const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: "#80a030" } }).png().toBuffer();
export const jpeg = await sharp(png).jpeg().toBuffer();
export const webp = await sharp(png).webp().toBuffer();
