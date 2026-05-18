import type { NextApiRequest, NextApiResponse } from 'next';
import { IncomingForm } from 'formidable';
import fs from 'fs';
import path from 'path';

interface ParseResponse {
  text?: string;
  error?: string;
}

// Parser imports — backend only, works great here
let mammoth: any = null;
let pdfjsLib: any = null;

// Lazy load pdfjs only once on backend
async function getPdfjsLib() {
  if (!pdfjsLib) {
    pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.js');
  }
  return pdfjsLib;
}

// Lazy load mammoth only once on backend
async function getMammoth() {
  if (!mammoth) {
    mammoth = await import('mammoth');
  }
  return mammoth.default;
}

async function parseDocx(filePath: string): Promise<string> {
  try {
    const mammothLib = await getMammoth();
    const result = await mammothLib.extractRawText({ path: filePath });
    return result.value || '';
  } catch (err) {
    throw new Error(`DOCX parsing: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }
}

async function parsePdf(filePath: string): Promise<string> {
  try {
    const pdfjs = await getPdfjsLib();
    const fileBuffer = fs.readFileSync(filePath);
    
    // Use the legacy/build version which works better server-side
    const pdf = await pdfjs.getDocument({ data: fileBuffer }).promise;
    let text = '';
    
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += (content.items as Array<{ str?: string }>)
        .map(item => item.str || '')
        .join(' ') + '\n';
    }
    
    return text;
  } catch (err) {
    throw new Error(`PDF parsing: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }
}

async function parseHtml(filePath: string): Promise<string> {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    // Strip HTML tags
    return content
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  } catch (err) {
    throw new Error(`HTML parsing: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }
}

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ParseResponse>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const uploadDir = path.join(process.cwd(), 'tmp');
  
  // Ensure tmp directory exists
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  const form = new IncomingForm({
    uploadDir,
    keepExtensions: true,
  });

  try {
    const [fields, files] = await form.parse(req);
    const fileArray = Array.isArray(files.file) ? files.file : [files.file];
    const file = fileArray?.[0];

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const ext = path.extname(file.originalFilename || '').toLowerCase().slice(1);
    const filePath = file.filepath;

    let text = '';

    try {
      if (ext === 'html' || ext === 'htm') {
        text = await parseHtml(filePath);
      } else if (ext === 'docx') {
        text = await parseDocx(filePath);
      } else if (ext === 'pdf') {
        text = await parsePdf(filePath);
      } else {
        return res.status(400).json({
          error: `Unsupported file type: ${ext}. Use HTML, DOCX, or PDF.`,
        });
      }

      if (!text || text.trim().length === 0) {
        return res.status(400).json({
          error: 'No text extracted from file. Try a different format.',
        });
      }

      return res.status(200).json({ text: text.substring(0, 50000) });
    } finally {
      // Clean up temp file
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return res.status(500).json({
      error: `Server error: ${message}`,
    });
  }
}
