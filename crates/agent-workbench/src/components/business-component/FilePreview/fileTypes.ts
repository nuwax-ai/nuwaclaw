/**
 * File type definitions and detection utilities.
 * Ported from nuwax FilePreview component.
 */

export type DocumentType = 'docx' | 'xlsx' | 'pptx' | 'pdf';
export type ImageType = 'image';
export type AudioType = 'audio';
export type VideoType = 'video';
export type HtmlType = 'html';
export type MarkdownType = 'markdown';
export type TextType = 'text';
export type UnsupportedType = 'unsupported';

export type FileType =
  | DocumentType
  | ImageType
  | AudioType
  | VideoType
  | HtmlType
  | MarkdownType
  | TextType
  | UnsupportedType;

export const EXTENSION_MAP: Record<string, FileType> = {
  docx: 'docx', doc: 'docx',
  xlsx: 'xlsx', xls: 'xlsx',
  pptx: 'pptx', ppt: 'pptx',
  pdf: 'pdf',
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image',
  webp: 'image', svg: 'image', bmp: 'image', ico: 'image',
  mp3: 'audio', wav: 'audio', ogg: 'audio',
  m4a: 'audio', aac: 'audio', flac: 'audio',
  mp4: 'video', webm: 'video', mov: 'video',
  avi: 'video', mkv: 'video',
  html: 'html', htm: 'html',
  md: 'markdown', markdown: 'markdown',
  txt: 'text', json: 'text', xml: 'text',
  js: 'text', jsx: 'text', ts: 'text', tsx: 'text',
  css: 'text', less: 'text', scss: 'text', sass: 'text',
  yaml: 'text', yml: 'text',
  ini: 'text', conf: 'text',
  sh: 'text', bash: 'text',
  py: 'text', java: 'text',
  c: 'text', cpp: 'text', h: 'text',
  go: 'text', rs: 'text', rb: 'text', php: 'text',
  sql: 'text', log: 'text', csv: 'text',
};

const CONTENT_TYPE_MAP: Record<string, FileType> = {
  'image/jpeg': 'image', 'image/png': 'image', 'image/gif': 'image',
  'image/webp': 'image', 'image/svg+xml': 'image', 'image/bmp': 'image',
  'audio/mpeg': 'audio', 'audio/wav': 'audio', 'audio/ogg': 'audio',
  'audio/mp4': 'audio', 'audio/aac': 'audio',
  'video/mp4': 'video', 'video/webm': 'video', 'video/quicktime': 'video',
  'text/html': 'html',
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/plain': 'text', 'text/markdown': 'markdown',
  'application/json': 'text', 'application/xml': 'text',
};

export function getFileTypeFromName(name: string): FileType {
  const cleanName = name.split('?')[0].split('#')[0];
  const ext = cleanName.split('.').pop()?.toLowerCase() || '';
  return EXTENSION_MAP[ext] || 'unsupported';
}

export function getFileTypeFromContentType(contentType: string): FileType {
  const baseType = contentType.split(';')[0].trim().toLowerCase();
  return CONTENT_TYPE_MAP[baseType] || 'unsupported';
}

export function getExtension(name: string): string {
  const cleanName = name.split('?')[0].split('#')[0];
  return cleanName.split('.').pop()?.toLowerCase() || '';
}

const FILE_TYPE_ICONS: Record<FileType, string> = {
  docx: '\u{1F4C4}', xlsx: '\u{1F4CA}', pptx: '\u{1F3AC}', pdf: '\u{1F4D1}',
  image: '\u{1F5BC}', audio: '\u{1F3B5}', video: '\u{1F3AC}',
  html: '\u{1F310}', markdown: '\u{1F4DD}', text: '\u{1F4CB}',
  unsupported: '\u{1F4C1}',
};

export function getFileTypeIcon(type: FileType): string {
  return FILE_TYPE_ICONS[type] || '\u{1F4C1}';
}
