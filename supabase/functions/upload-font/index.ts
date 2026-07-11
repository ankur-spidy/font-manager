// Supabase Edge Function — upload-font
// Accepts a font file from the browser and stores it in the 'fonts' bucket
// using the service role key (never exposed to the browser).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ALLOWED = ['.ttf', '.otf', '.woff', '.woff2'];
const BUCKET  = 'fonts';

const MIME: Record<string, string> = {
  '.ttf':   'font/ttf',
  '.otf':   'font/otf',
  '.woff':  'font/woff',
  '.woff2': 'font/woff2',
};

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-upload-password',
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Password check
  const password = req.headers.get('x-upload-password') || '';
  const correctPassword = Deno.env.get('UPLOAD_PASSWORD') || '12345';
  if (password !== correctPassword) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Parse multipart form
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid form data' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const uploaded:   string[] = [];
  const duplicates: string[] = [];
  const errors:     string[] = [];

  // Use service role key — only available server-side
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const files = formData.getAll('fonts') as File[];

  for (const file of files) {
    const fileName = file.name;
    const ext      = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();

    if (!ALLOWED.includes(ext)) {
      errors.push(fileName);
      continue;
    }

    const mimeType = MIME[ext] || 'application/octet-stream';
    const buffer   = await file.arrayBuffer();

    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(fileName, buffer, { contentType: mimeType, upsert: false });

    if (!error) {
      uploaded.push(fileName);
    } else if (error.message?.toLowerCase().includes('already exists') || (error as any).statusCode === '409') {
      duplicates.push(fileName);
    } else {
      console.error(`Upload error for ${fileName}:`, error);
      errors.push(fileName);
    }
  }

  return new Response(
    JSON.stringify({ success: true, uploaded, duplicates, errors }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
