# Damas Vision web image: the production build of the Angular app served by nginx on
# port 8092, which also forwards the local vision service's API (/v1/*) on the same origin.
# See docker-compose.yml and docs/release/docker.md.

FROM node:26.13.1-alpine AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --no-audit --no-fund
COPY angular.json tsconfig.json tsconfig.app.json tsconfig.worker.json ngsw-config.json .postcssrc.json ./
COPY public ./public
COPY src ./src
RUN npx ng build

FROM nginx:1.30.7-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
# Tells the app to use the vision service of this server by default (ADR-043).
COPY docker/deployment.json /usr/share/nginx/html/deployment.json
COPY --from=build /app/dist/damas-vision/browser /usr/share/nginx/html
EXPOSE 8092
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8092/"]
