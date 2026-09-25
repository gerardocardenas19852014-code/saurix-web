import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { DataClientService } from './data-client.service';
import { Usuario } from '../../features/seguridad/usuarios/usuario.model';
import { hashPassword, pareceHashSha256 } from '../../shared/utils/password.util';
import { debeDesactivarsePorVigenciaVencida } from '../../shared/utils/vigencia.util';
import { BitacoraService } from '../../shared/services/bitacora.service';

/** Valores iniciales del catálogo genérico "Listas de valores" (ver
 *  shared/valor-lista): sin esto las pantallas que ya dependen de él
 *  (Cuentas de presupuesto, Movimientos, Fijos y Proyección) arrancarían
 *  con combos vacíos hasta que alguien los cargue a mano. Solo se siembra
 *  si el store está completamente vacío (ver ejecutar()), así que agregar
 *  o quitar valores aquí después no pisa lo que el usuario ya haya
 *  editado. */
const VALORES_LISTA_INICIALES: { grupo: string; clave: string; etiqueta: string; orden: number }[] = [
  { grupo: 'CuentaPresupuestoTipo', clave: 'Efectivo', etiqueta: 'Efectivo', orden: 1 },
  { grupo: 'CuentaPresupuestoTipo', clave: 'Banco', etiqueta: 'Banco', orden: 2 },
  { grupo: 'CuentaPresupuestoTipo', clave: 'Tarjeta', etiqueta: 'Tarjeta', orden: 3 },
  { grupo: 'CuentaPresupuestoTipo', clave: 'Ahorro', etiqueta: 'Ahorro', orden: 4 },
  { grupo: 'MovimientoPresupuestoTipo', clave: 'Ingreso', etiqueta: 'Ingreso', orden: 1 },
  { grupo: 'MovimientoPresupuestoTipo', clave: 'Gasto', etiqueta: 'Gasto', orden: 2 },
  { grupo: 'MovimientoRecurrenteFrecuencia', clave: 'Mensual', etiqueta: 'Mensual', orden: 1 },
  { grupo: 'MovimientoRecurrenteFrecuencia', clave: 'Anual', etiqueta: 'Anual', orden: 2 },
  { grupo: 'PresupuestoAnualEstatus', clave: 'Creacion', etiqueta: 'Creación', orden: 1 },
  { grupo: 'PresupuestoAnualEstatus', clave: 'Proyeccion', etiqueta: 'Proyección', orden: 2 },
  { grupo: 'PresupuestoAnualEstatus', clave: 'Autorizado', etiqueta: 'Autorizado', orden: 3 },
  { grupo: 'PresupuestoAnualEstatus', clave: 'Ejecutado', etiqueta: 'Ejecutado', orden: 4 },
];

const DATOS_ROOT = {
  nombreUsuario: 'root',
  nombre: 'Administrador',
  email: 'jcardenast@live.com.mx',
  password: '1234',
  role: 'admin',
  activo: true,
  fechaInicioVigencia: '1900-01-01',
  fechaFinVigencia: '2060-12-31',
};

/**
 * Datos mínimos de arranque para que la app sea usable desde el primer
 * momento (IndexedDB empieza vacía, no hay ningún usuario todavía):
 * garantiza que exista el usuario 'root' (rol 'admin', vigencia amplia
 * 1900–2060) con los datos exactos pedidos por el usuario. Se ejecuta una
 * vez al arrancar la app (ver `provideAppInitializer` en app.config.ts).
 *
 * 'root' es la puerta de entrada garantizada mientras no hay backend real
 * (sin esto, un usuario bloqueado por intentos fallidos, con la contraseña
 * cambiada por accidente, desactivado o con la vigencia rota se quedaría
 * sin forma de volver a entrar): en CADA arranque, si algo de eso le pasó a
 * 'root', se repara para que root/1234 SIEMPRE funcione — sin tocar
 * `nombre`/`email`/`role` si ya estaban capturados a mano.
 *
 * También migra, una sola vez, cualquier contraseña que haya quedado en
 * texto plano de antes de que existiera el hashing (ver password.util) —
 * necesario para no dejar fuera a cuentas creadas antes de este cambio.
 *
 * Y, cada vez que arranca la app, sincroniza "Activo" con la vigencia: un
 * usuario cuya fecha final de vigencia ya pasó se desactiva automáticamente
 * (el login ya lo bloqueaba de todos modos por vigencia, pero sin esto la
 * columna Activo de la lista se queda mintiendo hasta que alguien lo edite
 * a mano — ver vigencia.util).
 */
@Injectable({ providedIn: 'root' })
export class SeedService {
  private readonly data = inject(DataClientService);
  // BitacoraService no depende de nada que dependa de SeedService, así que
  // esta inyección aquí es segura (sin ciclo).
  private readonly bitacora = inject(BitacoraService);

  async ejecutar(): Promise<void> {
    const usuarios = await firstValueFrom(this.data.list<Usuario>('Usuario'));
    const root = usuarios.find((u) => u.nombreUsuario.toLowerCase() === 'root');
    const hashRoot = await hashPassword(DATOS_ROOT.password);
    const hoy = new Date().toISOString().slice(0, 10);

    if (!root) {
      await firstValueFrom(this.data.alta<Usuario>('Usuario', { ...DATOS_ROOT, password: hashRoot }));
    } else {
      const leFaltanCampos = !root.nombre || !root.fechaInicioVigencia || !root.fechaFinVigencia;
      const vigenciaRota =
        !root.fechaInicioVigencia ||
        !root.fechaFinVigencia ||
        hoy < root.fechaInicioVigencia ||
        hoy > root.fechaFinVigencia;
      const accesoRoto =
        root.password !== hashRoot ||
        !root.activo ||
        !!root.bloqueadoHasta ||
        (root.intentosFallidos ?? 0) > 0 ||
        vigenciaRota;

      if (leFaltanCampos || accesoRoto) {
        await firstValueFrom(
          this.data.modificacion<Usuario>('Usuario', {
            ...root,
            nombre: root.nombre || DATOS_ROOT.nombre,
            email: root.email || DATOS_ROOT.email,
            role: root.role || DATOS_ROOT.role,
            password: hashRoot,
            activo: true,
            bloqueadoHasta: null,
            intentosFallidos: 0,
            fechaInicioVigencia: DATOS_ROOT.fechaInicioVigencia,
            fechaFinVigencia: DATOS_ROOT.fechaFinVigencia,
            id: root.id,
          }),
        );
      }
    }

    // Root ya queda garantizado arriba (password/activo/vigencia/bloqueo) —
    // se excluye de estos dos pasos para no pisar ese arreglo con su
    // snapshot viejo (de antes del alta/reparación de esta misma corrida).
    const usuariosSinRoot = usuarios.filter((u) => u.nombreUsuario.toLowerCase() !== 'root');
    await this.migrarPasswordsPlanos(usuariosSinRoot);
    await this.desactivarVencidos(usuariosSinRoot);
    await this.sembrarValoresLista();
  }

  /** Siembra por GRUPO (no todo o nada): un grupo que ya tiene aunque sea un
   *  valor se deja intacto (no pisa lo que el usuario ya haya editado ahí),
   *  pero un grupo nuevo que se agregue después a VALORES_LISTA_INICIALES
   *  (como PresupuestoAnualEstatus) sí se siembra aunque la instalación ya
   *  tenga meses de uso y otros grupos con datos — antes esto solo corría
   *  si ValorLista estaba 100% vacía, así que un grupo agregado después
   *  nunca llegaba a arrancar solo en una instalación ya existente. */
  private async sembrarValoresLista(): Promise<void> {
    const existentes = await firstValueFrom(this.data.list<{ id: number; grupo: string }>('ValorLista'));
    const gruposConDatos = new Set(existentes.map((v) => v.grupo));
    for (const valor of VALORES_LISTA_INICIALES) {
      if (gruposConDatos.has(valor.grupo)) continue;
      await firstValueFrom(this.data.alta('ValorLista', valor));
    }
  }

  private async desactivarVencidos(usuarios: Usuario[]): Promise<void> {
    for (const usuario of usuarios) {
      if (debeDesactivarsePorVigenciaVencida(usuario)) {
        const actualizado = await firstValueFrom(
          this.data.modificacion<Usuario>('Usuario', { ...usuario, activo: false }),
        );
        await firstValueFrom(
          this.bitacora.registrar({
            modulo: 'Seguridad / Usuarios',
            entidad: 'Usuario',
            accion: 'Desactivación automática (vigencia vencida)',
            usuario: 'Sistema',
            registroId: actualizado.id,
            anterior: { activo: true },
            actual: { activo: false },
          }),
        );
      }
    }
  }

  private async migrarPasswordsPlanos(usuarios: Usuario[]): Promise<void> {
    for (const usuario of usuarios) {
      if (usuario.password && !pareceHashSha256(usuario.password)) {
        const hash = await hashPassword(usuario.password);
        await firstValueFrom(this.data.modificacion<Usuario>('Usuario', { ...usuario, password: hash }));
      }
    }
  }
}
