import type { AnyMessageContent } from '@whiskeysockets/baileys';

export const ALLOWED_FILE_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'pdf',
  'txt',
  'md',
  'csv',
  'py',
  'js',
  'ts',
  'yaml',
  'yml',
  'html',
  'zip',
  'mp4',
  'mov',
  'mp3',
  'ogg',
  'wav',
  'm4a',
]);

export const EXTENSION_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  py: 'text/x-python',
  js: 'text/javascript',
  ts: 'text/typescript',
  yaml: 'text/yaml',
  yml: 'text/yaml',
  html: 'text/html',
  zip: 'application/zip',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  m4a: 'audio/m4a',
};

// Size limits (bytes)
export const IMAGE_SIZE_LIMIT = 16 * 1024 * 1024; // 16MB
export const GENERAL_SIZE_LIMIT = 100 * 1024 * 1024; // 100MB

export function isAllowedExtension(ext: string): boolean {
  return ALLOWED_FILE_EXTENSIONS.has(ext.toLowerCase());
}

export function getMimeType(ext: string): string {
  return EXTENSION_TO_MIME[ext.toLowerCase()] || 'application/octet-stream';
}

export function isImageMime(mime: string): boolean {
  return mime.startsWith('image/');
}

/** Validate container path is inside /workspace/group/ with no traversal */
export function validateContainerPath(containerPath: string): string | null {
  const prefix = '/workspace/group/';
  if (!containerPath.startsWith(prefix))
    return 'Path must be inside /workspace/group/';
  const relative = containerPath.slice(prefix.length);
  if (!relative) return 'Path cannot be /workspace/group/ itself';
  if (relative.split('/').some((seg) => seg === '..'))
    return 'Path traversal not allowed';
  return null; // valid
}

/** Build Baileys message content from buffer + mimetype */
export function buildBaileysFileContent(
  buffer: Buffer,
  mimetype: string,
  caption?: string,
  fileName?: string,
): AnyMessageContent {
  if (mimetype.startsWith('image/')) {
    return { image: buffer, caption, mimetype } as AnyMessageContent;
  }
  if (mimetype.startsWith('video/')) {
    return { video: buffer, caption, mimetype } as AnyMessageContent;
  }
  if (mimetype.startsWith('audio/')) {
    return { audio: buffer, mimetype, ptt: false } as AnyMessageContent;
  }
  // Default: document (includes pdf, txt, csv, zip, code files, etc.)
  return {
    document: buffer,
    mimetype,
    fileName: fileName || 'file',
    caption,
  } as AnyMessageContent;
}
