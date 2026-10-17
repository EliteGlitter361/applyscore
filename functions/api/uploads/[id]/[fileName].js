import { getRawFileContentFromGitee } from '../../../utils/gitee';

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const segments = url.pathname.split('/').filter(s => s);
  const id = segments[2];
  const fileName = segments[3];

  if (!id || !fileName) return new Response('Not Found', { status: 404 });

  try {
    const filePath = `data/uploads/${id}/${fileName}`;
    const base64Content = await getRawFileContentFromGitee(env, filePath);
    const binaryStr = atob(base64Content);
    const buffer = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) buffer[i] = binaryStr.charCodeAt(i);

    const ext = fileName.split('.').pop().toLowerCase();
    const mimeTypes = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
      gif: 'image/gif', webp: 'image/webp',
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls: 'application/vnd.ms-excel',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      zip: 'application/zip', txt: 'text/plain',
    };
    const mime = mimeTypes[ext] || 'application/octet-stream';

    return new Response(buffer, {
      headers: {
        'Content-Type': mime,
        'Cache-Control': 'public, max-age=604800, stale-while-revalidate=86400, immutable',
      },
    });
  } catch (e) {
    return new Response('File not found', { status: 404 });
  }
}