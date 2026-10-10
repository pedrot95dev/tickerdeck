FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
# better-sqlite3 ships prebuilt binaries in its package; without --ignore-scripts npm
# still tries a node-gyp rebuild, which needs Python and a compiler.
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM node:24-slim
ENV NODE_ENV=production DATA_DIR=/data PORT=8080
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev --workspace server --ignore-scripts && mkdir /data
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/web/dist web/dist
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT}/api/health`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
# Starts as root only to take ownership of the data folder: a folder mounted from a Linux host
# belongs to whoever created it there. The server itself runs as the non-root user node.
ENTRYPOINT ["sh", "-c", "chown -R node:node \"$DATA_DIR\" && exec setpriv --reuid=node --regid=node --init-groups \"$@\"", "--"]
CMD ["node", "server/dist/index.js"]
