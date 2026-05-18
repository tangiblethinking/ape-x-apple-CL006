import type { NextApiRequest, NextApiResponse } from 'next';
import { IncomingForm } from 'formidable';
import fs from 'fs';
import path from 'path';

interface ParseResponse {
  text?: string;
  error?: string;
  details?: string;
}

export const config = {
  api: {
    bodyParser: false,
  },
};

/**
 * Parse DOCX using mammoth
 */
async function parseDocx(filePath: string): Promise<string> {
  try {
    // Use require for Node.js compatibility
    const mammoth = require('mammoth');
    
    if (!mammoth.extractRawText) {
      throw new Error('mammoth.extractRawText not available');
    }

    const result = await mammoth.extractRawText({ path: filePath });
    const text = result.value || '';

    if (!text || !text.trim()) {
      throw new Error('DOCX file contains no extractable text');
    }

    return text;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`DOCX Error: ${msg}`);
  }
}

/**
 * Parse PDF using pdf-parse (Node.js compatible)
 */
async function parsePdf(filePath: string): Promise<string> {
  try {
    // Use require for Node.js compatibility
    const PDFParse = require('pdf-parse');

    if (!PDFParse) {
      throw new Error('pdf-parse module not available');
    }

    // Read file buffer
    const fileBuffer = fs.readFileSync(filePath);

    if (!fileBuffer || fileBuffer.length === 0) {
      throw new Error('PDF file is empty or unreadable');
    }

    // Parse PDF
    const data = await PDFParse(fileBuffer);

    if (!data || !data.text) {
      throw new Error('No text extracted from PDF — file may be image-based or encrypted');
    }

    const text = data.text.trim();

    if (!text) {
      throw new Error('PDF contains no readable text');
    }

    return text;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`PDF Error: ${msg}`);
  }
}

/**
 * Parse HTML by stripping tags
 */
async function parseHtml(filePath: string): Promise<string> {
  try {
    if (!fs.existsSync(filePath)) {
      throw new Error('HTML file not found at temp location');
    }

    const content = fs.readFileSync(filePath, 'utf-8');

    if (!content) {
      throw new Error('HTML file is empty');
    }

    // Strip HTML tags and normalize whitespace
    const text = content
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!text) {
      throw new Error('HTML contains no readable text');
    }

    return text;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`HTML Error: ${msg}`);
  }
}

/**
 * Main API handler
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ParseResponse>
) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const uploadDir = path.join(process.cwd(), 'tmp');
  let filePath = '';

  try {
    // Ensure tmp directory exists
    if (!fs.existsSync(uploadDir)) {
      try {
        fs.mkdirSync(uploadDir, { recursive: true });
      } catch (mkdirErr) {
        return res.status(500).json({
          error: 'Server configuration error',
          details: `Failed to create upload directory: ${mkdirErr}`,
        });
      }
    }

    // Initialize form parser
    const form = new IncomingForm({
      uploadDir,
      keepExtensions: true,
      maxFileSize: 50 * 1024 * 1024, // 50MB
    });

    // Parse incoming form
    let fields, files;
    try {
      [fields, files] = await form.parse(req);
    } catch (parseErr) {
      return res.status(400).json({
        error: 'File upload failed',
        details: `Form parsing error: ${parseErr}`,
      });
    }

    // Extract file from parsed form
    const fileArray = Array.isArray(files.file) ? files.file : [files.file];
    const file = fileArray?.[0];

    if (!file) {
      return res.status(400).json({
        error: 'No file uploaded',
        details: 'Please select a file to parse',
      });
    }

    // Get file info
    filePath = (file as any).filepath || (file as any).path;
    const fileName = (file as any).originalFilename || (file as any).name || '';

    if (!filePath) {
      return res.status(400).json({
        error: 'File upload error',
        details: 'Uploaded file has no path',
      });
    }

    // Verify file exists
    if (!fs.existsSync(filePath)) {
      return res.status(500).json({
        error: 'Server error',
        details: 'Uploaded file not found in temp directory',
      });
    }

    // Get file extension
    const ext = path.extname(fileName).toLowerCase().slice(1);

    if (!ext) {
      return res.status(400).json({
        error: 'Invalid file',
        details: 'File has no extension. Use .html, .docx, or .pdf',
      });
    }

    let text = '';

    // Parse based on file type
    try {
      if (ext === 'html' || ext === 'htm') {
        text = await parseHtml(filePath);
      } else if (ext === 'docx') {
        text = await parseDocx(filePath);
      } else if (ext === 'pdf') {
        text = await parsePdf(filePath);
      } else {
        return res.status(400).json({
          error: `Unsupported file type: .${ext}`,
          details: 'Supported formats: .html, .docx, .pdf',
        });
      }
    } catch (parseErr) {
      const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
      return res.status(400).json({
        error: 'Parse failed',
        details: msg,
      });
    }

    // Validate we got text
    if (!text || text.trim().length === 0) {
      return res.status(400).json({
        error: 'No text extracted',
        details: 'File exists but contains no readable text. Try a different file format.',
      });
    }

    // Return success (limit response size to 50KB)
    return res.status(200).json({
      text: text.substring(0, 50000),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('parse-resume API error:', msg);
    return res.status(500).json({
      error: 'Server error',
      details: msg,
    });
  } finally {
    // Always clean up temp file
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (unlinkErr) {
        console.error('Failed to cleanup temp file:', unlinkErr);
        // Don't fail the request due to cleanup error
      }
    }
  }
}


