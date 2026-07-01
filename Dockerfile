FROM node:20-bookworm-slim AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:20-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/out ./out
COPY --from=build /app/web ./web
COPY --from=build /app/assets ./assets
COPY --from=build /app/scripts ./scripts

EXPOSE 8000 18888

CMD ["node", "out/server.js"]
