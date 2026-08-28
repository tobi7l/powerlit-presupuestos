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
   el nombre `DD-MM-AA - Cliente.pdf`.

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

El catálogo vive en `src/catalog.json` (categoría, subcategoría, capacidad, precio).
Para cambiar un precio, renombrar o agregar un producto nuevo, se edita ese archivo
y se reinstala la app (ver abajo). El producto "Conos" está cargado con precio $0
como placeholder — conviene actualizarlo ahí apenas se tenga el precio.

## Cambiar el logo

El logo (usado en la app y en el membrete del PDF) es `src/logo.png`. Para
reemplazarlo, pisar ese archivo (fondo transparente, logo centrado, sin
márgenes extra) y correr `npm run make-icon` para regenerar el ícono de la
app a partir del logo nuevo, y después `npm run build`.

## Desarrollo / cómo generar el instalador

Requisitos: Node.js instalado.

```
npm install       # una sola vez
npm start         # correr la app en modo desarrollo
npm run make-icon # regenerar build/icon.ico y src/icon.ico si se cambia src/logo.png
npm run build     # genera el instalador .exe en la carpeta dist/
```

El instalador queda en `dist/Powerlit Presupuestos Setup <version>.exe`.
