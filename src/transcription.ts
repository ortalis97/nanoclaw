import fs from 'fs';
import path from 'path';

import {
  downloadMediaMessage,
  normalizeMessageContent,
} from '@whiskeysockets/baileys';
import { WAMessage, WASocket } from '@whiskeysockets/baileys';

import { readEnvFile } from './env.js';
import { resolveGroupFolderPath } from './group-folder.js';

interface TranscriptionConfig {
  model: string;
  enabled: boolean;
  fallbackMessage: string;
}

const DEFAULT_CONFIG: TranscriptionConfig = {
  model: 'whisper-1',
  enabled: true,
  fallbackMessage: '[Voice Message - transcription unavailable]',
};

async function transcribeWithOpenAI(
  audioBuffer: Buffer,
  config: TranscriptionConfig,
): Promise<string | null> {
  const env = readEnvFile(['OPENAI_API_KEY']);
  const apiKey = env.OPENAI_API_KEY;

  if (!apiKey) {
    console.warn('OPENAI_API_KEY not set in .env');
    return null;
  }

  try {
    const openaiModule = await import('openai');
    const OpenAI = openaiModule.default;
    const toFile = openaiModule.toFile;

    const openai = new OpenAI({ apiKey });

    const file = await toFile(audioBuffer, 'voice.ogg', {
      type: 'audio/ogg',
    });

    const transcription = await openai.audio.transcriptions.create({
      file: file,
      model: config.model,
      response_format: 'text',
    });

    // When response_format is 'text', the API returns a plain string
    return transcription as unknown as string;
  } catch (err) {
    console.error('OpenAI transcription failed:', err);
    return null;
  }
}

export async function transcribeAudioMessage(
  msg: WAMessage,
  sock: WASocket,
): Promise<string | null> {
  const config = DEFAULT_CONFIG;

  if (!config.enabled) {
    return config.fallbackMessage;
  }

  try {
    const buffer = (await downloadMediaMessage(
      msg,
      'buffer',
      {},
      {
        logger: console as any,
        reuploadRequest: sock.updateMediaMessage,
      },
    )) as Buffer;

    if (!buffer || buffer.length === 0) {
      console.error('Failed to download audio message');
      return config.fallbackMessage;
    }

    console.log(`Downloaded audio message: ${buffer.length} bytes`);

    const transcript = await transcribeWithOpenAI(buffer, config);

    if (!transcript) {
      return config.fallbackMessage;
    }

    return transcript.trim();
  } catch (err) {
    console.error('Transcription error:', err);
    return config.fallbackMessage;
  }
}

export function isVoiceMessage(msg: WAMessage): boolean {
  return msg.message?.audioMessage?.ptt === true;
}

export function isImageMessage(msg: WAMessage): boolean {
  const normalized = normalizeMessageContent(msg.message);
  return normalized?.imageMessage != null;
}

export async function downloadImageMessage(
  msg: WAMessage,
  sock: WASocket,
): Promise<{ buffer: Buffer; mimetype: string } | null> {
  const normalized = normalizeMessageContent(msg.message);
  const imageMsg = normalized?.imageMessage;
  if (!imageMsg) return null;

  const buffer = (await downloadMediaMessage(
    msg,
    'buffer',
    {},
    {
      logger: console as any,
      reuploadRequest: sock.updateMediaMessage,
    },
  )) as Buffer;

  if (!buffer || buffer.length === 0) return null;

  return {
    buffer,
    mimetype: imageMsg.mimetype || 'image/jpeg',
  };
}

export function saveImageToGroup(
  groupFolder: string,
  buffer: Buffer,
  mimetype: string,
  messageId: string,
): string {
  const ext =
    mimetype === 'image/png'
      ? 'png'
      : mimetype === 'image/webp'
        ? 'webp'
        : mimetype === 'image/gif'
          ? 'gif'
          : 'jpg';
  const safeId =
    messageId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) ||
    `img-${Date.now()}`;
  const filename = `${safeId}.${ext}`;
  const groupDir = resolveGroupFolderPath(groupFolder);
  const imagesDir = path.join(groupDir, 'images');
  fs.mkdirSync(imagesDir, { recursive: true });
  fs.writeFileSync(path.join(imagesDir, filename), buffer);
  return `/workspace/group/images/${filename}`;
}
