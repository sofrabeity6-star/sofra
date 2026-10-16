# بديل عن Render: صورة Docker واحدة تبني نسخة الويب وتشغّل الخادم
FROM node:22-slim AS web
WORKDIR /app/mobile
COPY mobile/package*.json ./
RUN npm ci --no-audit --no-fund
COPY mobile ./
RUN npm run build:web

FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY src ./src
COPY scripts ./scripts
COPY --from=web /app/mobile/dist ./mobile/dist
ENV NODE_ENV=production PORT=3000 TRUST_PROXY=1
EXPOSE 3000
USER node
CMD ["node", "src/server.js"]
