/**
 * Convierte enlaces de YouTube/Google Drive en embeds reales — puerto
 * directo de `buildEmbedHtml`/`renderMarkdown` del prototipo de referencia
 * (wiki-demo-sidebar.html). Solo actúa quen la URL aparece SOLA en su
 * propio párrafo (así la deja `marked` cuando el Markdown original solo
 * tenía esa URL en su propia línea); cualquier otro texto se deja tal cual.
 */
const YOUTUBE_RE = /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=([\w-]+)|youtu\.be\/([\w-]+))(\S*)$/i;
const DRIVE_RE = /^https?:\/\/drive\.google\.com\/file\/d\/([\w-]+)\/?(view)?(\S*)$/i;

function embedParaUrl(url: string): string | null {
  const yt = url.match(YOUTUBE_RE);
  if (yt) {
    const id = yt[3] || yt[4];
    return `<div class="video-embed"><iframe src="https://www.youtube.com/embed/${id}" allowfullscreen loading="lazy"></iframe></div>`;
  }
  const drive = url.match(DRIVE_RE);
  if (drive) {
    return `<div class="video-embed"><iframe src="https://drive.google.com/file/d/${drive[1]}/preview" allowfullscreen loading="lazy"></iframe></div>`;
  }
  return null;
}

export function insertarEmbeds(html: string): string {
  return html.replace(/<p>\s*(https?:\/\/\S+)\s*<\/p>/gi, (completa, url: string) => embedParaUrl(url.trim()) ?? completa);
}
