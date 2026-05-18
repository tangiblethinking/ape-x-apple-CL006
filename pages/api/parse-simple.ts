import type { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';
import os from 'os';

interface ParseResponse {
  text?: string;
  error?: string;
}

function getTempDir(): string {
  const candidates = ['/tmp', os.tmpdir(), path.join(process.cwd(), '.vercel/tmp'), path.join(process.cwd(), 'tmp')];
  for (const dir of candidates) {
    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const testFile = path.join(dir, `.test-${Date.now()}`);
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
      return dir;
    } catch {
      continue;
    }
  }
  throw new Error('No writable temp');
}

// HTML - pure regex
function parseHtml(content: string): string {
  return content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

// DOCX - basic extraction by looking for text elements
function parseDocxSimple(buffer: Buffer): string {
  // DOCX is a ZIP file - look for text in XML
  const text = buffer.toString('latin1');
  const matches = text.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [];
  const extracted = matches
    .map(m => m.replace(/<[^>]*>/g, ''))
    .filter(m => m.trim())
    .join(' ');
  return extracted.trim();
}

// PDF - basic text extraction (very basic, won't work for all PDFs)
function parsePdfSimple(buffer: Buffer): string {
  const text = buffer.toString('latin1');
  // Very basic: look for text between BT...ET operators
  const matches = text.match(/BT[\s\S]*?ET/g) || [];
  let extracted = '';
  for (const match of matches) {
    const textMatches = match.match(/\((.*?)\)/g) || [];
    for (const tm of textMatches) {
      extracted += tm.slice(1, -1) + ' ';
    }
  }
  return extracted.replace(/\s+/g, ' ').trim();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ParseResponse>) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let filePath = '';
  try {
    const uploadDir = getTempDir();
    const { filename, data } = req.body;

    if (!filename || !data) {
      return res.status(400).json({ error: 'Missing filename or data' });
    }

    filePath = path.join(uploadDir, `simple-${Date.now()}-${filename}`);
    const buffer = Buffer.from(data, 'base64');
    fs.writeFileSync(filePath, buffer);

    const ext = path.extname(filename).toLowerCase().slice(1);
    let text = '';

    if (ext === 'html' || ext === 'htm') {
      const content = buffer.toString('utf-8');
      text = parseHtml(content);
    } else if (ext === 'docx') {
      text = parseDocxSimple(buffer);
    } else if (ext === 'pdf') {
      text = parsePdfSimple(buffer);
    } else {
      return res.status(400).json({ error: `Unsupported: .${ext}` });
    }

    if (!text || text.length === 0) {
      return res.status(400).json({ error: 'No text extracted' });
    }

    return res.status(200).json({ text: text.substring(0, 50000) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return res.status(500).json({ error: msg });
  } finally {
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch {}
    }
  }
}
