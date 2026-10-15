FROM node:22-bookworm-slim AS editor
ARG FUTO_EDITOR_COMMIT=54ac4aa3ad086c4a46794df61ebde22d3917dc1f
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /upstream
RUN git init && git remote add origin https://gitlab.futo.org/futo-notes/futo-notes.git && git fetch --depth 1 origin ${FUTO_EDITOR_COMMIT} && git checkout --detach FETCH_HEAD && test "$(git rev-parse HEAD)" = "${FUTO_EDITOR_COMMIT}"
RUN npm install -g pnpm@10.29.2 && pnpm install --frozen-lockfile --ignore-scripts
COPY scripts/build-editor.mjs /build-editor.mjs
RUN node /build-editor.mjs /upstream patch && pnpm exec vite build --config vite.editor.config.ts && node /build-editor.mjs /upstream package /output

FROM node:22-bookworm-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run check && npm run build

FROM nginx:stable-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY deploy/40-browser-config.sh /docker-entrypoint.d/40-browser-config.sh
COPY --from=web /app/dist /usr/share/nginx/html/web
COPY --from=editor /output/web /usr/share/nginx/html/web
COPY --from=editor /output/nginx/editor-csp.conf /etc/nginx/editor-csp.conf
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:8080/web/ || exit 1
