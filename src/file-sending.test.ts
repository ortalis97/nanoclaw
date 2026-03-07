import { describe, it, expect } from 'vitest';

import {
  validateContainerPath,
  isAllowedExtension,
  getMimeType,
  buildBaileysFileContent,
} from './file-sending.js';

// --- validateContainerPath ---

describe('validateContainerPath', () => {
  it('accepts a valid path inside /workspace/group/', () => {
    expect(validateContainerPath('/workspace/group/images/test.png')).toBeNull();
  });

  it('accepts a nested path inside /workspace/group/', () => {
    expect(validateContainerPath('/workspace/group/docs/reports/q1.pdf')).toBeNull();
  });

  it('rejects paths outside /workspace/group/', () => {
    expect(validateContainerPath('/workspace/other/file.txt')).not.toBeNull();
    expect(validateContainerPath('/tmp/file.txt')).not.toBeNull();
    expect(validateContainerPath('/workspace/file.txt')).not.toBeNull();
  });

  it('rejects the directory itself', () => {
    expect(validateContainerPath('/workspace/group/')).not.toBeNull();
  });

  it('rejects path traversal with ..', () => {
    expect(validateContainerPath('/workspace/group/../secret')).not.toBeNull();
    expect(validateContainerPath('/workspace/group/images/../../../etc/passwd')).not.toBeNull();
  });
});

// --- isAllowedExtension ---

describe('isAllowedExtension', () => {
  it('allows image extensions', () => {
    expect(isAllowedExtension('jpg')).toBe(true);
    expect(isAllowedExtension('jpeg')).toBe(true);
    expect(isAllowedExtension('png')).toBe(true);
    expect(isAllowedExtension('gif')).toBe(true);
    expect(isAllowedExtension('webp')).toBe(true);
  });

  it('allows document extensions', () => {
    expect(isAllowedExtension('pdf')).toBe(true);
    expect(isAllowedExtension('txt')).toBe(true);
    expect(isAllowedExtension('md')).toBe(true);
    expect(isAllowedExtension('csv')).toBe(true);
    expect(isAllowedExtension('zip')).toBe(true);
  });

  it('allows code file extensions', () => {
    expect(isAllowedExtension('py')).toBe(true);
    expect(isAllowedExtension('js')).toBe(true);
    expect(isAllowedExtension('ts')).toBe(true);
  });

  it('allows video extensions', () => {
    expect(isAllowedExtension('mp4')).toBe(true);
    expect(isAllowedExtension('mov')).toBe(true);
  });

  it('allows audio extensions', () => {
    expect(isAllowedExtension('mp3')).toBe(true);
    expect(isAllowedExtension('ogg')).toBe(true);
    expect(isAllowedExtension('wav')).toBe(true);
    expect(isAllowedExtension('m4a')).toBe(true);
  });

  it('blocks dangerous/sensitive extensions', () => {
    expect(isAllowedExtension('json')).toBe(false);
    expect(isAllowedExtension('env')).toBe(false);
    expect(isAllowedExtension('exe')).toBe(false);
    expect(isAllowedExtension('sh')).toBe(false);
    expect(isAllowedExtension('bat')).toBe(false);
    expect(isAllowedExtension('sql')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isAllowedExtension('JPG')).toBe(true);
    expect(isAllowedExtension('PDF')).toBe(true);
  });
});

// --- getMimeType ---

describe('getMimeType', () => {
  it('returns correct MIME for image types', () => {
    expect(getMimeType('jpg')).toBe('image/jpeg');
    expect(getMimeType('jpeg')).toBe('image/jpeg');
    expect(getMimeType('png')).toBe('image/png');
    expect(getMimeType('gif')).toBe('image/gif');
    expect(getMimeType('webp')).toBe('image/webp');
  });

  it('returns correct MIME for document types', () => {
    expect(getMimeType('pdf')).toBe('application/pdf');
    expect(getMimeType('txt')).toBe('text/plain');
    expect(getMimeType('zip')).toBe('application/zip');
    expect(getMimeType('csv')).toBe('text/csv');
  });

  it('returns correct MIME for audio/video types', () => {
    expect(getMimeType('mp3')).toBe('audio/mpeg');
    expect(getMimeType('ogg')).toBe('audio/ogg');
    expect(getMimeType('mp4')).toBe('video/mp4');
    expect(getMimeType('mov')).toBe('video/quicktime');
  });

  it('returns application/octet-stream for unknown extensions', () => {
    expect(getMimeType('xyz')).toBe('application/octet-stream');
    expect(getMimeType('unknown')).toBe('application/octet-stream');
  });
});

// --- buildBaileysFileContent ---

describe('buildBaileysFileContent', () => {
  const buf = Buffer.from('test');

  it('returns image content for image MIME types', () => {
    const content = buildBaileysFileContent(buf, 'image/png', 'a caption');
    expect(content).toMatchObject({ image: buf, caption: 'a caption', mimetype: 'image/png' });
    expect(content).not.toHaveProperty('document');
  });

  it('returns video content for video MIME types', () => {
    const content = buildBaileysFileContent(buf, 'video/mp4', 'clip');
    expect(content).toMatchObject({ video: buf, caption: 'clip', mimetype: 'video/mp4' });
  });

  it('returns audio content for audio MIME types with ptt=false', () => {
    const content = buildBaileysFileContent(buf, 'audio/mpeg');
    expect(content).toMatchObject({ audio: buf, mimetype: 'audio/mpeg', ptt: false });
  });

  it('returns document content for other MIME types', () => {
    const content = buildBaileysFileContent(buf, 'application/pdf', 'summary', 'report.pdf');
    expect(content).toMatchObject({
      document: buf,
      mimetype: 'application/pdf',
      fileName: 'report.pdf',
      caption: 'summary',
    });
  });

  it('uses default fileName when not provided for documents', () => {
    const content = buildBaileysFileContent(buf, 'application/zip') as Record<string, unknown>;
    expect(content['fileName']).toBe('file');
  });
});
