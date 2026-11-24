FROM node:24-bookworm-slim AS web
WORKDIR /src
COPY package*.json ./
COPY apps/desktop/package.json apps/desktop/package.json
COPY apps/web apps/web
COPY packages packages
RUN npm ci --ignore-scripts && npm run build --workspace @floem/web

FROM python:3.13-slim-bookworm
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libodbc2 && rm -rf /var/lib/apt/lists/*
COPY pyproject.toml ./
COPY src src
RUN pip install --no-cache-dir '.[server]' && useradd --create-home --uid 10001 floem && mkdir /data && chown floem /data
COPY --from=web /src/apps/web/dist /app/web
ENV FLOEM_SERVER_DATA=/data FLOEM_WEB_DIST=/app/web PYTHONUNBUFFERED=1
USER floem
ENTRYPOINT ["python", "-m", "floem_bi.server.deployment"]
CMD ["serve"]
