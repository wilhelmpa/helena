import path from 'node:path';
import { fileTypeFromBuffer, supportedMimeTypes } from 'file-type';
import mimeTypes from 'mime-types';

// Helena's one answer to "what type is this file": the extension through mime-types
// (mime-db), the content through file-type (magic numbers). Every place that names a
// type for a file (serving, the vault index, uploads, mail) asks here.

const OCTET_STREAM = 'application/octet-stream';

// Source code and other plain-text formats. Some of them mime-db files under unrelated
// media (`.ts` is MPEG transport stream video) or as script types a browser would run,
// so they are text/plain whatever mime-db says.
const PLAIN_TEXT_EXTENSIONS = new Set(
  (
    'txt log ini conf cfg env toml sh bash zsh ps1 bat py rb php js mjs cjs jsx ts tsx css ' +
    'scss less sql go rs java kt kts swift c h cpp hpp cs lua r pl dockerfile gradle ' +
    'properties diff patch tex srt vtt'
  ).split(' '),
);

// Where Helena answers differently from mime-db: an Obsidian canvas is JSON, YAML has
// its registered type (RFC 9512), and FLAC and M4V keep the types browsers play.
const OVERRIDES: Record<string, string> = {
  canvas: 'application/json',
  base: 'application/yaml',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  flac: 'audio/flac',
  m4v: 'video/mp4',
};

function extensionOf(name: string): string {
  return path.extname(name).slice(1).toLowerCase();
}

// The type a file name implies; application/octet-stream when it implies none.
export function mimeFromName(name: string): string {
  const extension = extensionOf(name);
  if (!extension) return OCTET_STREAM;
  if (PLAIN_TEXT_EXTENSIONS.has(extension)) return 'text/plain';
  return OVERRIDES[extension] ?? (mimeTypes.lookup(extension) || OCTET_STREAM);
}

// The usual extension of a type, with its dot (".pdf"); ".bin" for an unknown type.
export function extensionForMime(type: string): string {
  return `.${mimeTypes.extension(bareType(type)) || 'bin'}`;
}

function bareType(type: string | null | undefined): string {
  return (type ?? '').split(';')[0]!.trim().toLowerCase();
}

// Text-based formats. file-type recognises a few of them (XML, iCalendar, vCard, WebVTT)
// by a heuristic only, so its answer does not overrule a text-based claim, and a claim of
// one of them never demands a signature.
function isTextual(type: string): boolean {
  return (
    type.startsWith('text/') ||
    /[/+](xml|json|yaml)$/.test(type) ||
    type === 'application/javascript'
  );
}

// A claim that the bytes must prove: file-type knows the format's signature.
function needsSignature(type: string): boolean {
  return supportedMimeTypes.has(type) && !isTextual(type);
}

// Specific formats that live inside a generic container: OOXML, OpenDocument, EPUB and
// JAR inside ZIP; .doc/.xls/.ppt/.msg inside an OLE compound file. file-type names the
// container when it cannot tell the specific format from its entries.
const CONTAINERS = new Set(['application/zip', 'application/x-cfb']);
function isContainerMember(type: string): boolean {
  return /^application\/(vnd\.|msword$|x-msi$|java-archive$)|\+zip$/.test(type);
}

export class UploadTypeMismatchError extends Error {
  constructor(readonly claimed: string) {
    super(`The file's content is not ${claimed}`);
  }
}

// The type an upload is stored and served as. The client's declared type (or, without
// one, the file name's) is a claim; the bytes decide:
// - a claim of a format with a known signature must carry it (UploadTypeMismatchError);
// - bytes of a recognised binary format are stored as that format, whatever the claim,
//   so the instance's type allowlist judges what the file is, not what it says it is;
// - a text-based claim stays when file-type only guesses a text format, and a specific
//   format stays when file-type only recognises its container.
export async function detectUploadType(
  bytes: Uint8Array,
  filename: string,
  declared?: string | null,
): Promise<string> {
  const stated = bareType(declared);
  const claimed = stated && stated !== OCTET_STREAM ? stated : mimeFromName(filename);
  const sniffed = (await fileTypeFromBuffer(bytes))?.mime;
  if (!sniffed) {
    if (needsSignature(claimed)) throw new UploadTypeMismatchError(claimed);
    return claimed;
  }
  if (sniffed === claimed) return claimed;
  if (isTextual(sniffed) && isTextual(claimed)) return claimed;
  if (CONTAINERS.has(sniffed) && isContainerMember(claimed) && !needsSignature(claimed)) {
    return claimed;
  }
  return sniffed;
}
