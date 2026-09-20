import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { DataClientService } from './data-client.service';
import { Usuario } from '../../features/seguridad/usuarios/usuario.model';
import { hashPassword, pareceHashSha256 } from '../../shared/utils/password.util';
import { debeDesactivarsePorVigenciaVencida } from '../../shared/utils/vigencia.util';
import { BitacoraService } from '../../shared/services/bitacora.service';

/** Valores iniciales del catálogo genérico "Listas de valores" (Catálogos):
 *  sin esto las pantallas que ya dependen de él (Cuentas de presupuesto,
 *  Movimientos, Fijos y Proyección, Conexiones) arrancarían con combos
 *  vacíos hasta que alguien los cargue a mano. Solo se siembra si el store
 *  está completamente vacío (ver ejecutar()), así que agregar o quitar
 *  valores aquí después no pisa lo que el usuario ya haya editado. */
const VALORES_LISTA_INICIALES: { grupo: string; clave: string; etiqueta: string; orden: number }[] = [
  { grupo: 'CuentaPresupuestoTipo', clave: 'Efectivo', etiqueta: 'Efectivo', orden: 1 },
  { grupo: 'CuentaPresupuestoTipo', clave: 'Banco', etiqueta: 'Banco', orden: 2 },
  { grupo: 'CuentaPresupuestoTipo', clave: 'Tarjeta', etiqueta: 'Tarjeta', orden: 3 },
  { grupo: 'CuentaPresupuestoTipo', clave: 'Ahorro', etiqueta: 'Ahorro', orden: 4 },
  { grupo: 'MovimientoPresupuestoTipo', clave: 'Ingreso', etiqueta: 'Ingreso', orden: 1 },
  { grupo: 'MovimientoPresupuestoTipo', clave: 'Gasto', etiqueta: 'Gasto', orden: 2 },
  { grupo: 'MovimientoRecurrenteFrecuencia', clave: 'Mensual', etiqueta: 'Mensual', orden: 1 },
  { grupo: 'MovimientoRecurrenteFrecuencia', clave: 'Anual', etiqueta: 'Anual', orden: 2 },
  { grupo: 'ConfiguracionConexionProveedor', clave: 'SqlServer', etiqueta: 'SQL Server', orden: 1 },
  { grupo: 'ConfiguracionConexionProveedor', clave: 'PostgreSql', etiqueta: 'PostgreSQL', orden: 2 },
  { grupo: 'ConfiguracionConexionProveedor', clave: 'MySql', etiqueta: 'MySQL', orden: 3 },
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
 * Si 'root' ya existía de una versión anterior de la app (sin `nombre` ni
 * vigencia, de antes de que esos campos existieran), se repara para que
 * quede igual al estándar actual en vez de quedarse con el registro viejo.
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

    if (!root) {
      const rootConHash = { ...DATOS_ROOT, password: await hashPassword(DATOS_ROOT.password) };
      await firstValueFrom(this.data.alta<Usuario>('Usuario', rootConHash));
    } else {
      const leFaltaAlgo = !root.nombre || !root.fechaInicioVigencia || !root.fechaFinVigencia;
      if (leFaltaAlgo) {
        const rootConHash = { ...DATOS_ROOT, password: await hashPassword(DATOS_ROOT.password) };
        await firstValueFrom(
          this.data.modificacion<Usuario>('Usuario', { ...root, ...rootConHash, id: root.id }),
        );
      }
    }

    // 'usuarios' es la foto de ANTES de crear/reparar root, así que ya sea
    // que root se haya creado o reparado arriba, aquí solo migran las
    // contraseñas de cuentas que YA existían (root nuevo ya se guardó con
    // hash desde el alta, no necesita pasar por aquí).
    await this.migrarPasswordsPlanos(usuarios);
    await this.desactivarVencidos(usuarios);
    await this.sembrarValoresLista();
  }

  private async sembrarValoresLista(): Promise<void> {
    const existentes = await firstValueFrom(this.data.list<{ id: number }>('ValorLista'));
    if (existentes.length > 0) return;
    for (const valor of VALORES_LISTA_INICIALES) {
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
