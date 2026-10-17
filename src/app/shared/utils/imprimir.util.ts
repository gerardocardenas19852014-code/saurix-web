/**
 * Imprime HTML arbitrario usando un <iframe> OCULTO insertado en la propia
 * página — mismo patrón exacto que ProductosComponent.imprimirEtiquetas()
 * (ver productos.component.ts), ahora reutilizable para cualquier pantalla
 * que necesite imprimir (ticket de venta, etc.) en vez de reescribir el
 * truco del iframe cada vez.
 *
 * Nada de ventana/pestaña nueva (un bloqueador de pop-ups puede descartarla
 * en silencio, sin avisar) ni de ocultar el resto de la app con CSS
 * (depende de que TODO lo demás se oculte bien). El iframe necesita un
 * tamaño REAL (no 0x0) — con 0x0, Chrome/Edge recientes lo tratan como
 * "sin contenido que imprimir" y descartan print() en silencio — por eso
 * se posiciona fuera de la pantalla en vez de con tamaño cero.
 *
 * print() se llama de forma SÍNCRONA, en la misma cadena de ejecución del
 * clic/submit del usuario — algunos navegadores (confirmado: Brave) exigen
 * que print() se invoque dentro del mismo "gesto de usuario" o lo
 * descartan en silencio.
 */
export function imprimirHtml(titulo: string, cuerpoHtml: string, estiloExtra = '', anchoPx = 420): void {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.left = '-10000px';
  iframe.style.top = '0';
  iframe.style.width = `${anchoPx}px`;
  iframe.style.height = '700px';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const quitarIframe = () => {
    if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
  };

  try {
    const doc = iframe.contentDocument;
    if (!doc) throw new Error('El navegador no permitió preparar el documento de impresión.');

    doc.open();
    doc.write(`<!doctype html>
    <html lang="es">
      <head>
        <meta charset="utf-8" />
        <title>${escaparHtml(titulo)}</title>
        <style>
          * { box-sizing: border-box; }
          body { margin: 0; font-family: 'Courier New', Courier, monospace; color: #000; }
          ${estiloExtra}
        </style>
      </head>
      <body>${cuerpoHtml}</body>
    </html>`);
    doc.close();

    const ventana = iframe.contentWindow;
    if (!ventana) throw new Error('El navegador no permitió preparar la ventana de impresión.');

    try {
      ventana.focus();
      ventana.print();
    } catch (errPrint) {
      console.error('Error al imprimir:', errPrint);
    } finally {
      // La limpieza del iframe SÍ puede ir con retraso — quitar el DOM no
      // necesita ninguna activación de usuario, solo se espera a que el
      // diálogo de impresión ya se haya mostrado.
      setTimeout(quitarIframe, 1000);
    }
  } catch (error) {
    console.error('Error al generar la impresión:', error);
    quitarIframe();
    throw error;
  }
}

export function escaparHtml(texto: string): string {
  const div = document.createElement('div');
  div.textContent = texto;
  return div.innerHTML;
}
