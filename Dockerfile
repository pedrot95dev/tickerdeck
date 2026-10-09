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
RUN npm ci --omit=dev --workspace server --ignore-scripts && mkdir /data && chown node:node /data
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/web/dist web/dist
USER node
EXPOSE 8080
CMD ["node", "server/dist/index.js"]
