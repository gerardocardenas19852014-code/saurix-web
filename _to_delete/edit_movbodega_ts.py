import sys

path = "movimientos-bodega.component.ts"
with open(path, "r", encoding="utf-8") as f:
    src = f.read()

edits = [
    (
        "asignación inicial de la existencia que un producto ya traía antes de\n * este módulo — ver asignarABodega()), traspasos de cantidad entre",
        "asignación inicial de la existencia que un producto ya traía antes de\n * este módulo), traspasos de cantidad entre",
    ),
    (
        'Al abrir la pantalla solo se carga "Existencia por\n * bodega" (más el bloque de productos sin asignar); Historial y En tránsito',
        'Al abrir la pantalla solo se carga "Existencia por\n * bodega"; Historial y En tránsito',
    ),
    (
        "interface FilaSinAsignar {\n  productoId: number;\n  codigo: string;\n  nombre: string;\n  cantidad: number;\n}\n\n",
        "",
    ),
    (
        '  /** Bloque informativo de productos con existencia heredada sin asignar a\n   *  ninguna bodega (ver fn_movimientos_productos_sin_asignar) — acotado a\n   *  100 filas (caso transicional, se espera que sea chico o vacío). */\n  protected readonly productosSinAsignar = signal<FilaSinAsignar[]>([]);\n  protected readonly totalSinAsignar = signal(0);\n\n',
        "",
    ),
    (
        "  private async cargarProductosSinAsignar(): Promise<void> {\n    const resultado = await this.cargarSinAsignarSupabase();\n    this.productosSinAsignar.set(resultado.filas);\n    this.totalSinAsignar.set(resultado.total);\n  }\n\n  private async cargarSinAsignarSupabase(): Promise<{ filas: FilaSinAsignar[]; total: number }> {\n    const { data, error } = await this.sb.schema('inventario').rpc('fn_movimientos_productos_sin_asignar', {\n      p_desde: 0,\n      p_cantidad: 100,\n    });\n    if (error) return { filas: [], total: 0 };\n    const filas = (data ?? []) as Record<string, unknown>[];\n    return {\n      filas: filas.map((f) => ({\n        productoId: Number(f['id']),\n        codigo: String(f['codigo'] ?? ''),\n        nombre: String(f['nombre'] ?? ''),\n        cantidad: Number(f['existencia']) || 0,\n      })),\n      total: Number(filas[0]?.['total'] ?? 0),\n    };\n  }\n\n",
        "",
    ),
    (
        '    // Ninguna pestaña carga datos sola al abrir — igual que Productos y\n    // servicios, la tabla arranca vacía hasta el primer click en "Buscar"\n    // (ver busquedaRealizadaExistencia/busquedaRealizadaHistorial). El\n    // bloque de "sin asignar" es informativo, no un resultado de búsqueda,\n    // así que sí se carga de una vez.\n    this.cargarProductosSinAsignar();\n  }',
        '    // Ninguna pestaña carga datos sola al abrir — igual que Productos y\n    // servicios, la tabla arranca vacía hasta el primer click en "Buscar"\n    // (ver busquedaRealizadaExistencia/busquedaRealizadaHistorial).\n  }',
    ),
    (
        '   *  selecciona en el formulario — mismo criterio de "atajo" que\n   *  asignarABodega(): el usuario sigue siendo quien revisa el resto del\n   *  formulario antes de guardar. Solo busca entre productos físicos',
        '   *  selecciona en el formulario — el usuario sigue siendo quien revisa el\n   *  resto del formulario antes de guardar. Solo busca entre productos físicos',
    ),
    (
        "  /** Atajo desde la tabla \"sin asignar\": precarga Entrada con el producto y\n   *  la cantidad heredada ya puestos — el usuario solo elige la bodega\n   *  destino. */\n  asignarABodega(fila: FilaSinAsignar): void {\n    if (this.bodegasActivas().length === 0) {\n      this.toast.advertencia('Antes crea al menos una Bodega activa (Inventario → Bodegas).');\n      return;\n    }\n    this.form.reset({\n      tipo: 'entrada',\n      productoId: fila.productoId,\n      bodegaOrigenId: 0,\n      bodegaDestinoId: 0,\n      cantidad: fila.cantidad,\n      nota: 'Asignación inicial',\n      enTransito: false,\n    });\n    this.productoPreseleccionadoEtiqueta.set(fila.codigo ? `${fila.codigo} — ${fila.nombre}` : fila.nombre);\n    this.disponibleOrigen.set(null);\n    this.modalAbierto.set(true);\n  }\n\n",
        "",
    ),
    (
        "  /** Tras crear un movimiento: refresca solo la pestaña que se está viendo\n   *  (nunca las otras dos, que ni siquiera tienen por qué estar cargadas) y\n   *  el bloque de \"sin asignar\" (una Entrada puede vaciarlo). */\n  private refrescarTrasGuardar(): void {\n    this.cargarProductosSinAsignar();\n    if (this.tabActiva() === 'existencia') this.cargarExistencia();",
        "  /** Tras crear un movimiento: refresca solo la pestaña que se está viendo\n   *  (nunca las otras dos, que ni siquiera tienen por qué estar cargadas). */\n  private refrescarTrasGuardar(): void {\n    if (this.tabActiva() === 'existencia') this.cargarExistencia();",
    ),
]

errors = []
for i, (old, new) in enumerate(edits):
    count = src.count(old)
    if count != 1:
        errors.append(f"Edit #{i}: found {count} occurrences (expected 1)")
    else:
        src = src.replace(old, new)

if errors:
    print("ERRORS:")
    for e in errors:
        print(" -", e)
    sys.exit(1)

with open(path, "w", encoding="utf-8") as f:
    f.write(src)
print("OK — todos los reemplazos aplicados")
