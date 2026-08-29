# Powerlit — Generador de Presupuestos

App de escritorio para Windows que reemplaza la planilla de Google Sheets de presupuestos.
Sin fórmulas editables: los precios salen del catálogo interno y se recalculan solos.

## Uso diario (para cualquiera en la empresa)

1. Instalar una sola vez con el instalador (`Powerlit Presupuestos Setup x.x.x.exe`).
2. Abrir "Powerlit Presupuestos" desde el ícono del escritorio.
3. Completar cliente (si ya lo guardaste antes, escribí unas letras y elegilo de la
   lista — se autocompletan su dirección y sus descuentos habituales), dirección y fecha.
4. Por cada línea: escribir en "Detalle" (por ejemplo "75" o "cuatricapa") y elegir
   de la lista que aparece — busca por cualquier palabra, en cualquier orden, contra
   categoría + subcategoría + capacidad. Completar la cantidad; precio unitario e
   importe se calculan solos. El botón naranja "+" debajo de la columna Cantidad
   agrega una fila nueva (queda justo debajo del renglón anterior).
5. Elegir los descuentos si corresponden. Hay 3 desplegables de descuento (0/5/10/15/20%
   cada uno) que se aplican **en cadena**, uno sobre el saldo que deja el anterior — así se
   arma la escala de la empresa (10 tanques = 10%, 20 tanques = 10%+5%, 25 tanques = 10%+5%+5%)
   eligiendo el valor correspondiente en cada uno. El resultado combinado queda un poco por
   debajo de la simple suma de los tres porcentajes.
6. Tocar "Generar y guardar PDF". El PDF queda guardado automáticamente en la
   carpeta configurada (botón "⚙ Carpeta de guardado", arriba a la derecha), con
   el nombre `DD-MM-AA - Cliente.pdf`. Debajo aparecen "📄 Mostrar PDF" (lo abre) y
   "🗑 Limpiar plantilla" (arranca el próximo presupuesto).

### Modo Minorista

Por defecto la app cotiza a precio **mayorista**. El botón **"🛒 Modo Minorista"**
(arriba a la derecha) cambia a precio **minorista** — recalcula al toque todas las
filas que ya estén cargadas, no hace falta volver a elegir los productos.

Para que sea imposible no darse cuenta en qué modo se está (y evitar que alguien
cotice minorista por error, o al revés), mientras el modo minorista está activo:
- Aparece un cartel morado bien grande arriba de todo: "⚠ MODO MINORISTA".
- Todos los colores naranjas de la app (tabla de productos, botones) cambian a morado.
- El botón queda marcado como activo ("✓ Modo Minorista").
- Desaparecen "👥 Clientes" y "💾 Guardar cliente" (la lista de clientes es para
  mayorista; en minorista no aplica).
- Los 3 descuentos en cadena se reemplazan por un único campo "Descuento" simple.
- Aparece un campo "Teléfono" (al lado de la Fecha) para anotar el contacto de un
  cliente minorista que no está guardado en la lista — si se completa, sale impreso
  en el PDF junto con el cliente y la dirección.

El PDF generado se ve exactamente igual en los dos modos (mismo membrete, misma
tabla) — la única diferencia son los números de precio (y el teléfono, si se cargó
uno). El modo elegido no se guarda al cerrar la app: siempre arranca en mayorista,
para no dejarlo "trabado" en minorista sin querer de una sesión a la otra.

Los dos precios de cada producto viven en `src/catalog.json` (`precio` = mayorista,
`precioMinorista` = minorista). Los productos que no tienen precio minorista propio
(Cámara de inspección, Cámara registro de lodos, Base de tanque 2000/3000 lts, Conos)
usan el mismo precio que el mayorista como resguardo — conviene actualizarlos ahí
apenas se tenga el precio real.

### Carpeta de guardado / respaldo en Google Drive

La primera vez que se abre la app, intenta detectar sola si hay una carpeta de
Google Drive de escritorio sincronizada en la PC (revisa `Mi unidad` / `My Drive`
en el resto de las unidades, y las rutas típicas dentro de la carpeta de usuario).
Si la encuentra, guarda los PDF en `Powerlit/Presupuestos` dentro de esa carpeta,
para que quede respaldado en la nube sin subir nada a mano. Si no la encuentra,
usa la carpeta "Documentos" de Windows.

Junto al botón "⚙ Carpeta de guardado" hay un aviso que dice si se detectó Google
Drive en esa PC o no. Si dice que no se detectó (por ejemplo porque Google Drive
para escritorio no está instalado, o está instalado con otro usuario de Windows),
se puede apuntar manualmente: tocar "⚙ Carpeta de guardado" y elegir la carpeta real
de Google Drive en esa PC (normalmente aparece como una unidad propia, tipo `G:\Mi unidad`,
o dentro de "Este equipo"). Una vez elegida, queda guardada y se sigue usando siempre,
organizando por año/mes exactamente igual que si la hubiese detectado sola.

Dentro de esa carpeta, cada PDF se guarda solo en una subcarpeta por año y mes
según la fecha del presupuesto (por ejemplo `Powerlit/Presupuestos/2026/julio/`),
así queda todo ordenado sin tener que mover nada a mano.

En cualquier momento se puede cambiar la carpeta base de guardado con el botón
"⚙ Carpeta de guardado" (el orden por año/mes se sigue aplicando adentro).

### Importar pedido de un cliente

El botón "📥 Importar pedido" (arriba de la tabla de productos) interpreta un pedido
y precarga las filas solo, sin tocar internet ni ningún servicio externo:

- **Pegar texto**: copiá el mensaje de WhatsApp del cliente (uno o varios productos,
  cada uno en su renglón) y pegalo en el cuadro.
- **Adjuntar PDF**: si el cliente mandó una orden de compra en PDF, tocá "📎 Adjuntar
  PDF…" y elegilo — se extrae el texto solo. El precio que traiga el PDF del cliente
  se ignora siempre: la app cotiza con el precio propio del catálogo, nunca con el
  que puso el cliente.

Al tocar "Interpretar pedido" se agregan las filas encontradas. Si el mensaje no decía
el material (bicapa/tricapa/cuatricapa) de un tanque, la app asume **tricapa** y esa
fila queda resaltada en naranja para que la revises antes de generar el PDF — nunca
se genera nada sin pasar por la tabla de siempre. Las líneas que no se pudieron
interpretar (por ejemplo un producto que no está en el catálogo) se avisan abajo del
botón de generar, para cargarlas a mano con el buscador.

Las reglas de interpretación viven en `src/orderParser.js` (categorías, sinónimos,
abreviaturas de material) — si aparecen formas de escribir muy distintas a las
habituales, se pueden agregar ahí.

### Lista de clientes

Se guarda y edita todo desde la app, sin tocar archivos ni reinstalar:

- **💾 Guardar cliente** (al lado de Dirección): guarda el nombre, dirección y los 3
  descuentos que están cargados en el formulario en ese momento. Si ya existía un
  cliente con ese mismo nombre, lo actualiza en vez de duplicarlo.
- **👥 Clientes**: abre la lista completa de clientes guardados. "Usar" carga sus
  datos en el formulario (y cierra el panel); 🗑 lo elimina de la lista (pide
  confirmación).
- Al escribir en "Destinatario / Cliente" aparecen sugerencias de los clientes ya
  guardados que coincidan; al elegir uno se completan solos su dirección y sus 3
  descuentos — se pueden ajustar igual antes de generar si ese pedido puntual lleva
  otro descuento.

Si esta PC tiene Google Drive detectado (ver el aviso "☁ Google Drive detectado" /
"⚠ Google Drive no detectado" arriba a la derecha), la lista se guarda en
`Powerlit App/clientes.json` dentro de esa carpeta de Drive — así, cualquier cliente
que se cargue en una PC aparece solo en cualquier otra PC donde esté instalada la app
con esa misma cuenta de Google (una vez que Drive termine de sincronizar). Si no hay
Drive detectado en una PC, la lista queda guardada solo ahí hasta que se detecte Drive
(y en ese momento se migra sola a la carpeta compartida, sin perder lo que ya había).

## Actualizar precios o productos

El catálogo vive en `src/catalog.json` (categoría, subcategoría, capacidad, `precio`
mayorista y `precioMinorista`). Para cambiar un precio, renombrar o agregar un
producto nuevo, se edita ese archivo y se publica una actualización (ver la sección
de auto-actualización, más abajo). El producto "Conos" está cargado con precio $0
como placeholder — conviene actualizarlo ahí apenas se tenga el precio.

## Cambiar el logo

El logo (usado en la app y en el membrete del PDF) es `src/logo.png`. Para
reemplazarlo, pisar ese archivo (fondo transparente, logo centrado, sin
márgenes extra) y correr `npm run make-icon` para regenerar el ícono de la
app a partir del logo nuevo, y después `npm run build`.

## Auto-actualización

La app se fija sola, cada vez que arranca, si hay una versión más nueva publicada en
[GitHub Releases](https://github.com/tobi7l/powerlit-presupuestos/releases). Si la hay,
la descarga en segundo plano (solo la diferencia entre versiones, no el instalador
entero) y avisa con un cartel para reiniciar e instalarla — o se instala sola la
próxima vez que se cierre la app si se elige "Más tarde". También hay un botón
"🔄 Buscar actualización" arriba a la derecha para chequear al toque, sin esperar a
reabrir la app. La versión instalada se ve chiquita al lado de "Generador de
presupuestos".

Esto significa que, en general, **ya no hace falta pasar el instalador a mano** por
Drive/USB para actualizar — alcanza con publicar la versión nueva (ver abajo) y cada PC
la va a encontrar sola. La copia en `Powerlit App/` dentro de Drive queda solo como
respaldo para instalar por primera vez en una PC nueva.

## Desarrollo / cómo generar el instalador y publicar una actualización

Requisitos: Node.js instalado, y sesión iniciada en GitHub CLI (`gh auth login`) con
acceso al repo [tobi7l/powerlit-presupuestos](https://github.com/tobi7l/powerlit-presupuestos).

```
npm install       # una sola vez
npm start         # correr la app en modo desarrollo
npm run make-icon # regenerar build/icon.ico y src/icon.ico si se cambia src/logo.png
npm run build     # genera el instalador .exe en la carpeta dist/, sin publicarlo
```

Para publicar una actualización que las apps ya instaladas van a encontrar solas:

1. Subir el número de versión en `package.json` (campo `"version"`).
2. Publicar:
   ```
   export GH_TOKEN="$(gh auth token)"
   npm run release
   ```
3. GitHub crea el release como **borrador** — hay que publicarlo (una sola vez por
   versión) para que quede visible:
   ```
   gh release edit vX.Y.Z --repo tobi7l/powerlit-presupuestos --draft=false
   ```
   (reemplazar `vX.Y.Z` por la versión, por ejemplo `v1.1.2`).

Con eso, cualquier PC con una versión anterior instalada la va a detectar y ofrecer
instalar sola la próxima vez que abra la app (o al toque si tocan "🔄 Buscar
actualización").

El instalador queda en `dist/Powerlit Presupuestos Setup <version>.exe`.
