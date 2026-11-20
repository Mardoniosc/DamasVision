# Running Damas Vision with Docker

Two containers behind a single port, **8092**:

| Container | Image                         | Content                                                                              | Port                                           |
| --------- | ----------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------- |
| `web`     | `damas-vision-web:0.1.0-rc.1` | the production build (PWA) served by nginx; forwards `/v1/` to the vision service    | **8092**, published on `127.0.0.1` only        |
| `vision`  | `damas-vision-service:0.1.0`  | the local vision service (Python + OpenCV, ADR-042), non-root, read-only file system | 8765 inside the compose network, not published |

```bash
npm run docker:up
```

Then open **http://localhost:8092**. `localhost` is a secure context, so the camera works over plain HTTP. `npm run docker:down` stops the containers.

## Using the vision service (automatic)

The image serves `/deployment.json`, which makes the app use the **vision service of this server** by default: open the app and recognition already goes to the `vision` container, with no configuration. nginx forwards `/v1/*` on the same origin, so the browser needs no cross-origin access.

**Configurações → Reconhecimento** shows **Serviço de visão deste servidor (recomendado por este servidor)** selected; **Testar conexão** checks it.

- A choice saved on a device wins over the server's default. If you saved another option before (for example the address `http://127.0.0.1:8765`, which only works with `npm run vision:serve` on the same computer), choose **Serviço de visão deste servidor** and **Salvar** once.
- The browser recognizer (OpenCV.js) stays available.
- If the `vision` container is down, the app says so ("O serviço de visão deste servidor não respondeu…"). It never switches silently.
- The service's API documentation is at `/openapi.json`.

## Starting automatically

Both containers have `restart: unless-stopped`: they start again whenever Docker starts, until you stop them with `npm run docker:down`.

- On a Linux server, enable Docker at boot: `sudo systemctl enable docker`.
- With Docker Desktop (Windows/macOS), enable **Start Docker Desktop when you sign in**.

`web` waits for `vision` to be healthy before it starts.

## Publishing: this computer or the network

By default port 8092 is published on `127.0.0.1` only: the app is used on the server itself, and the frames never leave it.

To open it to the network, start with the bind address set:

```bash
DAMAS_VISION_BIND=0.0.0.0 docker compose up -d --build --wait
```

The app and its service then answer on `http://<server address>:8092`, and the frames travel on your network to this server (never elsewhere).

**The camera needs a secure context.** A browser opens the camera only on `https://` pages or on `http://localhost`. From another device, `http://<server address>:8092` shows the app but the camera is refused. Put an HTTPS reverse proxy (with a certificate the devices trust) in front of port 8092.

## Details

- **Images:** built from `node:26.13.1-alpine` (build stage), `nginx:1.30.7-alpine` and `python:3.11.9-slim-bookworm`.
  - The Python image installs the runtime pins of `requirements.txt` constrained by `requirements.lock`, so transitive versions are exact too.
  - Test tools are not installed in it.
- **Health checks:** `vision` answers `/v1/health`; `web` waits for it before starting, and is checked on `/`.
- **Service worker:** every call to the service carries `ngsw-bypass`, so the app's service worker never holds service requests while it prefetches the app.
- **Limits:** nginx accepts bodies up to 9 MB; the service refuses anything above 8 MB.
- **Test:** `npm run e2e:docker` (with the containers up) runs the service E2E suite against port 8092: calibration, recognition, diagnostics, correction and camera-detected moves.
