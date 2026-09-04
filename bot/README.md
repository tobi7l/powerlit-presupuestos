# Bot de Telegram — Presupuestos Powerlit

Genera presupuestos por chat, sin abrir la app. Reusa el mismo catálogo, parser de
pedidos y plantilla de PDF que la app de escritorio (`../src/`), así el resultado es
idéntico al que genera la app.

## Uso (una vez desplegado)

Mandarle `/start` (o cualquier mensaje) al bot. Todo se elige tocando botones — mayorista
o minorista, el cliente (de una lista paginada, o "cliente ocasional"), y en minorista
además teléfono, descuento y sello — salvo dos cosas que siguen siendo más rápido
escribirlas: el nombre de un cliente que no está guardado, y el pedido en sí (productos
y cantidades), un renglón por línea:

```
10 1000T
6 750B
```

- **Mayorista:** elegís el cliente de la lista guardada (usa sus 3 descuentos en
  cadena) o "Cliente ocasional" (sin descuento, salvo que elijas uno de los botones o
  escribas uno propio tipo `10+5`). Para buscarlo se puede escribir parte del nombre
  cuando el bot lo pide, o usar el modo inline: escribir `@nombredelbot fen` en el chat
  (con arroba) tira sugerencias en vivo, tipo buscador, arriba del teclado — hay que
  activarlo una vez con `/setinline` en @BotFather.
- **Minorista:** escribís el nombre, tocás teléfono (opcional), el tipo de descuento
  (ninguno / % / monto fijo en $) y el sello del PDF (Pagado / A pagar / ninguno). Usa
  la lista de precios minorista del catálogo.

Al final el bot arma el PDF y lo manda por Telegram. Si se configuró
`DRIVE_PRESUPUESTOS_FOLDER_ID`, también deja una copia en Drive organizada por año/mes,
igual que la app. `/nuevo` en cualquier momento reinicia el flujo desde cero.

## Probar la lógica sin desplegar nada

```
cd bot
npm install
node test-local.js
```

Genera `bot/test-output.pdf` con un cliente y pedido de ejemplo hardcodeados en el
script, sin necesitar token de Telegram ni credenciales de Drive. Sirve para validar
que el parser/catálogo/plantilla siguen andando bien después de cualquier cambio.

## Desplegar en una VM de Google Cloud (nivel gratuito)

### 1. Crear la VM

En la consola de Google Cloud (console.cloud.google.com) → Compute Engine → Crear
instancia:
- Nombre: `powerlit-bot`
- Región: una de las que entran en el nivel "Always Free" (`us-west1`, `us-central1`
  o `us-east1`)
- Tipo de máquina: `e2-micro`
- Sistema operativo: Debian o Ubuntu (imagen por defecto sirve)

### 2. Conectarse por SSH e instalar Node.js

Desde la consola de Google Cloud, botón "SSH" al lado de la VM (abre una terminal en
el navegador, no hace falta instalar nada extra):

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git
```

### 3. Traer el código

```bash
git clone https://github.com/tobi7l/powerlit-presupuestos.git
cd powerlit-presupuestos/bot
npm install
```

Puppeteer baja su propio Chromium, pero en un Debian/Ubuntu recién instalado le van a
faltar sus librerías del sistema — instalarlas antes de probar (si falta alguna otra,
el error de Puppeteer al lanzar el navegador la nombra):

```bash
sudo apt-get install -y libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
  libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 \
  libasound2 libpango-1.0-0 libcairo2 libatspi2.0-0
```

Probar que la generación de PDF funciona en esta VM antes de seguir:

```bash
node test-local.js   # tiene que terminar con "PDF de prueba escrito en ..."
```

### 4. Cuenta de servicio de Google (para leer/escribir en Drive)

1. En la consola de Google Cloud → IAM y administración → Cuentas de servicio → Crear
   cuenta de servicio. Nombre: `powerlit-bot`.
2. Una vez creada, pestaña "Claves" → Agregar clave → JSON. Se descarga un archivo.
3. Subir ese archivo a la VM como `powerlit-presupuestos/bot/service-account.json`
   (por ejemplo arrastrándolo en la misma ventana de SSH del navegador, que tiene un
   botón para subir archivos).
4. Copiar el mail de la cuenta de servicio (termina en
   `...@<proyecto>.iam.gserviceaccount.com`, se ve en la lista de cuentas de servicio).
5. En Google Drive, compartir la carpeta **"Powerlit App"** y la carpeta
   **"Presupuestos"** con ese mail, con permiso de Editor — igual que se comparte una
   carpeta con cualquier persona.

### 5. Datos de Drive

- Abrir `clientes.json` dentro de "Powerlit App" en Drive (o click derecho → "Obtener
  enlace") y copiar el ID de la URL: `.../file/d/`**`ESTE_ID`**`/view`.
- Abrir la carpeta "Presupuestos" y copiar el ID de su URL:
  `.../folders/`**`ESTE_ID`**.

### 6. Configurar el bot

```bash
cp .env.example .env
nano .env
```

Completar `TELEGRAM_BOT_TOKEN` (el que dio @BotFather), `DRIVE_CLIENTES_FILE_ID`,
`DRIVE_PRESUPUESTOS_FOLDER_ID`. Para `TELEGRAM_ALLOWED_CHAT_IDS`, hablarle a
**@userinfobot** en Telegram para conseguir el chat id propio.

### 7. Dejarlo corriendo siempre (systemd)

```bash
sudo tee /etc/systemd/system/powerlit-bot.service > /dev/null <<'EOF'
[Unit]
Description=Bot de Telegram - Presupuestos Powerlit
After=network.target

[Service]
WorkingDirectory=/home/%u/powerlit-presupuestos/bot
ExecStart=/usr/bin/node index.js
Restart=always
User=%u

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now powerlit-bot
sudo systemctl status powerlit-bot   # confirmar que dice "active (running)"
journalctl -u powerlit-bot -f        # ver los logs en vivo
```

### 8. Actualizar el bot más adelante

```bash
cd ~/powerlit-presupuestos
git pull
sudo systemctl restart powerlit-bot
```
