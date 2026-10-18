/**
 * Mapa entidad (nombre lógico que usan las pantallas, p.ej. 'MovimientoPresupuesto')
 * → [esquema, tabla, columnas] en Supabase.
 * Columnas: 'nombre_snake:tipo' — t=texto, u=uuid, n=número, f=fecha (date),
 * h=fecha-hora (timestamptz), b=booleano, j=json.
 *
 * GENERADO desde information_schema del proyecto Supabase "Saurix".
 * Si agregas una tabla o columna en supabase/migrations, agrégala aquí también.
 */
export type TipoColumna = 't' | 'u' | 'n' | 'f' | 'h' | 'b' | 'j';

const MAPA: Record<string, [string, string, string]> = {
  Empresa: ['seguridad', 'empresa', 'id:n,clave:t,nombre:t,max_usuarios:n,descripcion_publica:t,telefono_pedidos:t,correo_pedidos:t,logo_publico:t,catalogo_publico_activo:b,horario_atencion:j,metodos_pago:j,pedido_minimo:n,envio_origen_lat:n,envio_origen_lng:n,envio_precio_km:n,envio_minimo:n,envio_distancia_maxima_km:n,volver_pedir_activo:b,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  EmpresaModulo: ['seguridad', 'empresa_modulo', 'id:n,empresa_id:n,modulo_clave:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  CitaMedicaMiembro: ['familia', 'cita_medica_miembro', 'id:n,miembro_familia_id:n,motivo:t,especialidad:t,fecha:f,lugar:t,notas:t,completada:b,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  CitaMedicaMiembroAdjunto: ['familia', 'cita_medica_miembro_adjunto', 'id:n,cita_medica_miembro_id:n,nombre_archivo:t,tipo_contenido:t,ruta_storage:t,tamano_bytes:n,comentario:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  ContactoEmergenciaMiembro: ['familia', 'contacto_emergencia_miembro', 'id:n,miembro_familia_id:n,nombre:t,relacion:t,telefono:t,notas:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  ContactoFamiliar: ['familia', 'contacto_familiar', 'id:n,nombre:t,categoria:t,telefono:t,correo:t,direccion:t,notas:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  DocumentoFamilia: ['familia', 'documento_familia', 'id:n,miembro_familia_id:n,tipo_documento_clave:t,fecha_vencimiento:f,notas:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  DocumentoFamiliaAdjunto: ['familia', 'documento_familia_adjunto', 'id:n,documento_familia_id:n,nombre_archivo:t,tipo_contenido:t,ruta_storage:t,tamano_bytes:n,comentario:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  EventoFamiliar: ['familia', 'evento_familiar', 'id:n,miembro_familia_id:n,titulo:t,fecha:f,notas:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  MedicionCrecimiento: ['familia', 'medicion_crecimiento', 'id:n,miembro_familia_id:n,fecha:f,peso_kg:n,estatura_cm:n,notas:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  MiembroFamilia: ['familia', 'miembro_familia', 'id:n,nombre:t,apellido_paterno:t,apellido_materno:t,parentesco_clave:t,fecha_nacimiento:f,sexo:t,entidad_nacimiento:t,tipo_sangre:t,telefono:t,foto:t,rfc:t,curp:t,alergias:t,condiciones_cronicas:t,medicamentos:t,numero_seguro_social:t,contacto_emergencia_nombre:t,contacto_emergencia_telefono:t,aseguradora:t,numero_poliza:t,padre_id:n,madre_id:n,conyuge_id:n,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  ParienteReferencia: ['familia', 'pariente_referencia', 'id:n,miembro_familia_id:n,nombre:t,parentesco:t,fecha_nacimiento:f,fallecido:b,fecha_fallecimiento:f,notas:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  PolizaSeguroMiembro: ['familia', 'poliza_seguro_miembro', 'id:n,miembro_familia_id:n,tipo:t,aseguradora:t,numero_poliza:t,fecha_vigencia_inicio:f,fecha_vigencia_fin:f,notas:t,suma_asegurada:n,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  TareaHogar: ['familia', 'tarea_hogar', 'id:n,titulo:t,miembro_familia_id:n,frecuencia:t,completada:b,fecha_limite:f,notas:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  TramiteEstado: ['familia', 'tramite_estado', 'id:n,nombre:t,orden:n,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  TramiteFamiliar: ['familia', 'tramite_familiar', 'id:n,titulo:t,miembro_familia_id:n,tramite_estado_id:n,fecha_limite:f,notas:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  VacunaMiembro: ['familia', 'vacuna_miembro', 'id:n,miembro_familia_id:n,nombre:t,fecha_aplicacion:f,dosis:t,notas:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  VacunaMiembroAdjunto: ['familia', 'vacuna_miembro_adjunto', 'id:n,vacuna_miembro_id:n,nombre_archivo:t,tipo_contenido:t,ruta_storage:t,tamano_bytes:n,comentario:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  AvisoStockBajo: ['inventario', 'aviso_stock_bajo', 'id:n,producto_id:n,bodega_id:n,usuario_id:n,dia:f,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  Bodega: ['inventario', 'bodega', 'id:n,nombre:t,clave:t,direccion:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  CategoriaProducto: ['inventario', 'categoria_producto', 'id:n,nombre:t,clave:t,descripcion:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  ConteoFisico: ['inventario', 'conteo_fisico', 'id:n,bodega_id:n,usuario_id:n,fecha:h,total_productos:n,total_diferencias:n,notas:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  ConteoFisicoDetalle: ['inventario', 'conteo_fisico_detalle', 'id:n,conteo_fisico_id:n,producto_id:n,sistema:n,contado:n,diferencia:n,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  ExistenciaBodega: ['inventario', 'existencia_bodega', 'id:n,producto_id:n,bodega_id:n,existencia:n,ubicacion:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  MovimientoInventario: ['inventario', 'movimiento_inventario', 'id:n,producto_id:n,bodega_origen_id:n,bodega_destino_id:n,cantidad:n,fecha:f,nota:t,orden_compra_id:n,costo_unitario:n,en_transito:b,fecha_recepcion:h,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  NivelMinimoBodega: ['inventario', 'nivel_minimo_bodega', 'id:n,producto_id:n,bodega_id:n,nivel_minimo:n,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  PrecioLista: ['inventario', 'precio_lista', 'id:n,tipo_lista_precio_id:n,producto_id:n,precio:n,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  Producto: ['inventario', 'producto', 'id:n,nombre:t,codigo:t,categoria_producto_id:n,unidad_medida_id:n,descripcion:t,costo:n,precio_unitario:n,existencia:n,nivel_minimo:n,nivel_maximo:n,proveedor_id:n,unidad_compra_id:n,factor_conversion_compra:n,maneja_lotes:b,foto:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  Proveedor: ['inventario', 'proveedor', 'id:n,nombre:t,contacto:t,telefono:t,correo:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  ProductoProveedor: ['inventario', 'producto_proveedor', 'id:n,producto_id:n,proveedor_id:n,precio_compra:n,tiempo_entrega_dias:n,preferido:b,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  ProductoOpcionGrupo: ['inventario', 'producto_opcion_grupo', 'id:n,producto_id:n,nombre:t,tipo_seleccion:t,requerido:b,minimo:n,maximo:n,orden:n,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  ProductoOpcionValor: ['inventario', 'producto_opcion_valor', 'id:n,grupo_id:n,nombre:t,precio_adicional:n,orden:n,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  OrdenCompra: ['inventario', 'orden_compra', 'id:n,folio:t,proveedor_id:n,bodega_destino_id:n,estado:t,fecha:f,fecha_entrega_estimada:f,notas:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  OrdenCompraItem: ['inventario', 'orden_compra_item', 'id:n,orden_compra_id:n,producto_id:n,cantidad:n,costo_unitario:n,cantidad_recibida:n,unidad_id:n,factor_conversion:n,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  TipoListaPrecio: ['inventario', 'tipo_lista_precio', 'id:n,nombre:t,clave:t,descripcion:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  RegimenFiscal: ['ventas', 'regimen_fiscal', 'id:n,clave:t,nombre:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  AvisoOrdenVencida: ['inventario', 'aviso_orden_vencida', 'id:n,orden_compra_id:n,usuario_id:n,dia:f,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  LoteProducto: ['inventario', 'lote_producto', 'id:n,producto_id:n,bodega_id:n,lote:t,fecha_caducidad:f,cantidad:n,notas:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  UnidadMedida: ['inventario', 'unidad_medida', 'id:n,nombre:t,clave:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  Cliente: ['ventas', 'cliente', 'id:n,nombre:t,rfc:t,es_extranjero:b,regimen_fiscal_clave:t,pais:t,codigo_postal:t,colonia:t,calle:t,numero_exterior:t,numero_interior:t,estado:t,municipio:t,localidad:t,correo:t,telefono:t,lista_precio_predeterminada_id:n,es_generico:b,puntos_acumulados:n,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  TurnoCaja: ['ventas', 'turno_caja', 'id:n,usuario_id:n,fecha_apertura:h,monto_apertura:n,notas_apertura:t,fecha_cierre:h,monto_cierre_contado:n,monto_cierre_esperado:n,diferencia_cierre:n,notas_cierre:t,estado:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  Venta: ['ventas', 'venta', 'id:n,folio:t,fecha:h,turno_caja_id:n,cliente_id:n,vendedor_usuario_id:n,subtotal:n,descuento:n,total:n,estado:t,notas:t,canal:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  VentaItem: ['ventas', 'venta_item', 'id:n,venta_id:n,producto_id:n,descripcion:t,cantidad:n,precio_unitario:n,descuento_pct:n,subtotal:n,bodega_id:n,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  VentaPago: ['ventas', 'venta_pago', 'id:n,venta_id:n,metodo_pago:t,monto:n,monto_recibido:n,cambio:n,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  Devolucion: ['ventas', 'devolucion', 'id:n,folio:t,venta_id:n,fecha:h,usuario_id:n,motivo:t,total_reembolsado:n,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  DevolucionItem: ['ventas', 'devolucion_item', 'id:n,devolucion_id:n,venta_item_id:n,producto_id:n,descripcion:t,cantidad:n,precio_unitario:n,subtotal:n,bodega_id:n,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  Cotizacion: ['ventas', 'cotizacion', 'id:n,folio:t,fecha:h,fecha_vigencia:f,cliente_id:n,vendedor_usuario_id:n,subtotal:n,descuento:n,total:n,estado:t,notas:t,venta_convertida_id:n,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  CotizacionItem: ['ventas', 'cotizacion_item', 'id:n,cotizacion_id:n,producto_id:n,descripcion:t,cantidad:n,precio_unitario:n,descuento_pct:n,subtotal:n,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  ConfiguracionVentas: ['ventas', 'configuracion_ventas', 'id:n,conteo_caja_por_denominacion:b,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  TurnoCajaDenominacion: ['ventas', 'turno_caja_denominacion', 'id:n,turno_caja_id:n,momento:t,valor:n,cantidad:n,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  CuentaPorCobrar: ['ventas', 'cuenta_por_cobrar', 'id:n,venta_id:n,cliente_id:n,fecha:h,monto_original:n,saldo_pendiente:n,estado:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  AbonoCuentaPorCobrar: ['ventas', 'abono_cuenta_por_cobrar', 'id:n,cuenta_por_cobrar_id:n,fecha:h,monto:n,metodo_pago:t,turno_caja_id:n,usuario_id:n,notas:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  ComisionVendedor: ['ventas', 'comision_vendedor', 'id:n,usuario_id:n,tipo:t,valor:n,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  ConfiguracionLealtad: ['ventas', 'configuracion_lealtad', 'id:n,programa_activo:b,pesos_por_punto:n,pesos_descuento_por_punto:n,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  MovimientoPuntosCliente: ['ventas', 'movimiento_puntos_cliente', 'id:n,cliente_id:n,fecha:h,puntos:n,tipo:t,venta_id:n,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  PedidoTienda: ['ventas', 'pedido_tienda', 'id:n,empresa_id:n,nombre_cliente:t,telefono_cliente:t,notas_cliente:t,ubicacion_lat:n,ubicacion_lng:n,items:j,total:n,estado:t,venta_id:n,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  ConfiguracionApariencia: ['panel_control', 'configuracion_apariencia', 'id:n,usuario_id:n,tema:t,asistente_ia_activo:b,tamano_pagina_grid:n,vista_proyectos_preferida:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  ValorLista: ['panel_control', 'valor_lista', 'id:n,grupo:t,clave:t,etiqueta:t,orden:n,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  AvisoTarjetaCiclo: ['presupuesto', 'aviso_tarjeta_ciclo', 'id:n,cuenta_presupuesto_id:n,usuario_id:n,tipo_aviso:t,ciclo:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  CategoriaPresupuesto: ['presupuesto', 'categoria_presupuesto', 'id:n,nombre:t,tipo:t,categoria_presupuesto_padre_id:n,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  CuentaPresupuesto: ['presupuesto', 'cuenta_presupuesto', 'id:n,nombre:t,tipo:t,limite_credito:n,dia_corte:n,dia_pago:n,pago_minimo:n,pago_sin_intereses:n,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  DeudaPresupuesto: ['presupuesto', 'deuda_presupuesto', 'id:n,descripcion:t,monto_original:n,saldo_actual:n,fecha_inicio:f,fecha_vencimiento:f,creado_por_usuario_id:n,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  DeudaPresupuestoAbono: ['presupuesto', 'deuda_presupuesto_abono', 'id:n,deuda_presupuesto_id:n,fecha:f,monto:n,nota:t,cuenta_presupuesto_id:n,movimiento_presupuesto_id:n,creado_por_usuario_id:n,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  LimitePresupuesto: ['presupuesto', 'limite_presupuesto', 'id:n,categoria_presupuesto_id:n,monto_limite:n,creado_por_usuario_id:n,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  MetaPresupuesto: ['presupuesto', 'meta_presupuesto', 'id:n,nombre:t,monto_objetivo:n,monto_actual:n,fecha_limite:f,creado_por_usuario_id:n,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  MetaPresupuestoAporte: ['presupuesto', 'meta_presupuesto_aporte', 'id:n,meta_presupuesto_id:n,fecha:f,monto:n,nota:t,cuenta_presupuesto_id:n,movimiento_presupuesto_id:n,creado_por_usuario_id:n,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  MovimientoPresupuesto: ['presupuesto', 'movimiento_presupuesto', 'id:n,fecha:f,tipo:t,cuenta_presupuesto_id:n,categoria_presupuesto_id:n,monto:n,descripcion:t,transferencia_id:u,origen_recurrente_id:n,proyectado:b,creado_por_usuario_id:n,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  MovimientoPresupuestoAdjunto: ['presupuesto', 'movimiento_presupuesto_adjunto', 'id:n,movimiento_presupuesto_id:n,nombre_archivo:t,tipo_contenido:t,ruta_storage:t,tamano_bytes:n,comentario:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  MovimientoRecurrentePresupuesto: ['presupuesto', 'movimiento_recurrente_presupuesto', 'id:n,descripcion:t,tipo:t,cuenta_presupuesto_id:n,categoria_presupuesto_id:n,monto:n,frecuencia:t,dia_del_mes:n,aviso_faltante_ciclo:t,creado_por_usuario_id:n,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  MovimientoRecurrentePresupuestoAdjunto: ['presupuesto', 'movimiento_recurrente_presupuesto_adjunto', 'id:n,movimiento_recurrente_presupuesto_id:n,nombre_archivo:t,tipo_contenido:t,ruta_storage:t,tamano_bytes:n,comentario:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  PresupuestoAnual: ['presupuesto', 'presupuesto_anual', 'id:n,anio:n,fecha_alta:f,descripcion:t,estatus_clave:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  ProyeccionAjuste: ['presupuesto', 'proyeccion_ajuste', 'id:n,quincena:t,clave:t,monto:n,creado_por_usuario_id:n,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  Proyecto: ['proyectos', 'proyecto', 'id:n,nombre:t,clave:t,codigo_hex:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  Sprint: ['proyectos', 'sprint', 'id:n,proyecto_id:n,nombre:t,objetivo:t,fecha_inicio:f,fecha_fin:f,estado:t,orden:n,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  TableroColumna: ['proyectos', 'tablero_columna', 'id:n,proyecto_id:n,clave:t,nombre:t,orden:n,permite_actividades:b,permite_anexos:b,permite_asociados:b,configuracion_campos_json:t,transiciones_permitidas_json:t,posicion_diagrama_json:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  Ticket: ['proyectos', 'ticket', 'id:n,proyecto_id:n,tablero_columna_id:n,ticket_tipo_id:n,ticket_prioridad_id:n,ticket_modulo_id:n,asignado_usuario_id:n,reportado_por_usuario_id:n,numero_ticket:t,folio_interno:t,titulo:t,descripcion:t,planeado:b,tiempo_estimado_min:n,fecha_fin_analisis:f,fecha_fin_desarrollo:f,fecha_fin_cliente:f,fecha_inicio:f,fecha_fin:f,solucion:t,sla_aviso_nivel:t,ticket_padre_id:n,sprint_id:n,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  TicketActividad: ['proyectos', 'ticket_actividad', 'id:n,ticket_id:n,texto:t,tiempo_min:n,creado_por:n,fecha_creacion:h,fecha_modificacion:h,modificado_por:n,activo:b'],
  TicketAdjunto: ['proyectos', 'ticket_adjunto', 'id:n,ticket_id:n,nombre_archivo:t,tipo_contenido:t,ruta_storage:t,tamano_bytes:n,comentario:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  TicketComentario: ['proyectos', 'ticket_comentario', 'id:n,ticket_id:n,texto:t,creado_por:n,fecha_creacion:h,fecha_modificacion:h,modificado_por:n,activo:b'],
  TicketDependencia: ['proyectos', 'ticket_dependencia', 'id:n,ticket_id:n,ticket_relacionado_id:n,tipo:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  TicketEtiqueta: ['proyectos', 'ticket_etiqueta', 'id:n,ticket_id:n,texto:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  TicketHistorialEstado: ['proyectos', 'ticket_historial_estado', 'id:n,ticket_id:n,tablero_columna_anterior_id:n,tablero_columna_nueva_id:n,usuario_id:n,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  TicketModulo: ['proyectos', 'ticket_modulo', 'id:n,nombre:t,clave:t,icono:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  TicketPrioridad: ['proyectos', 'ticket_prioridad', 'id:n,nombre:t,clave:t,codigo_hex:t,vigencia_horas:n,aviso_horas:n,critica:b,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  TicketPrioridadNotificar: ['proyectos', 'ticket_prioridad_notificar', 'id:n,ticket_prioridad_id:n,usuario_id:n,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  TicketSeguidor: ['proyectos', 'ticket_seguidor', 'id:n,ticket_id:n,usuario_id:n,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  TicketTipo: ['proyectos', 'ticket_tipo', 'id:n,nombre:t,clave:t,icono:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  Bitacora: ['seguridad', 'bitacora', 'id:n,modulo:t,entidad:t,accion:t,registro_id:n,usuario:t,fecha:h,cambios:j,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  Notificacion: ['seguridad', 'notificacion', 'id:n,usuario_id:n,titulo:t,link:t,leida:b,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  Permiso: ['seguridad', 'permiso', 'id:n,nombre:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  Rol: ['seguridad', 'rol', 'id:n,nombre:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  RolPermiso: ['seguridad', 'rol_permiso', 'id:n,rol_id:n,permiso_id:n,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  Usuario: ['seguridad', 'usuario', 'id:n,auth_user_id:u,nombre_usuario:t,nombre:t,apellido_paterno:t,apellido_materno:t,email:t,role:t,fecha_inicio_vigencia:f,fecha_fin_vigencia:f,ultimo_acceso:h,debe_cambiar_password:b,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  Categoria: ['wikidocs', 'categoria', 'id:n,tipo_sistema_id:n,nombre:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  Documento: ['wikidocs', 'documento', 'id:n,seccion_id:n,titulo:t,contenido:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  DocumentoAdjunto: ['wikidocs', 'documento_adjunto', 'id:n,documento_id:n,nombre_archivo:t,tipo_contenido:t,ruta_storage:t,tamano_bytes:n,comentario:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  DocumentoFavorito: ['wikidocs', 'documento_favorito', 'id:n,documento_id:n,usuario:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  DocumentoReferenciaModulo: ['wikidocs', 'documento_referencia_modulo', 'id:n,documento_id:n,ruta:t,etiqueta:t,grupo:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  DocumentoReferenciaProceso: ['wikidocs', 'documento_referencia_proceso', 'id:n,documento_id:n,texto:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  DocumentoReferenciaTabla: ['wikidocs', 'documento_referencia_tabla', 'id:n,documento_id:n,texto:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  DocumentoRelacion: ['wikidocs', 'documento_relacion', 'id:n,documento_id:n,documento_relacionado_id:n,tipo:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  DocumentoVersion: ['wikidocs', 'documento_version', 'id:n,documento_id:n,titulo:t,contenido:t,usuario:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  PlantillaDocumento: ['wikidocs', 'plantilla_documento', 'id:n,nombre:t,contenido:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  Seccion: ['wikidocs', 'seccion', 'id:n,categoria_id:n,nombre:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  TipoSistema: ['wikidocs', 'tipo_sistema', 'id:n,nombre:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
};

export interface DefinicionTabla {
  esquema: string;
  tabla: string;
  /** columna en camelCase → { columna snake_case, tipo } */
  columnas: Map<string, { snake: string; tipo: TipoColumna }>;
}

const snakeACamel = (s: string): string => s.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());

const CACHE = new Map<string, DefinicionTabla>();

/** true si la entidad ya está mapeada a una tabla real de Supabase. Para
 *  features construidas primero en el frontend (IndexedDB) y pendientes de
 *  migrar — ver esquema-tablas-saurix.md del proyecto Claude — permite que
 *  list() se degrade a "sin datos" en vez de un error, sin tener que tocar
 *  cada pantalla una por una. */
export function entidadExiste(entidad: string): boolean {
  return Object.prototype.hasOwnProperty.call(MAPA, entidad);
}

export function definicionTabla(entidad: string): DefinicionTabla {
  const enCache = CACHE.get(entidad);
  if (enCache) return enCache;
  const fila = MAPA[entidad];
  if (!fila) throw new Error(`La entidad '${entidad}' no existe en Supabase (ver supabase-esquema.ts).`);
  const [esquema, tabla, cols] = fila;
  const columnas = new Map<string, { snake: string; tipo: TipoColumna }>();
  for (const par of cols.split(',')) {
    const [snake, tipo] = par.split(':');
    columnas.set(snakeACamel(snake), { snake, tipo: tipo as TipoColumna });
  }
  const def = { esquema, tabla, columnas };
  CACHE.set(entidad, def);
  return def;
}
