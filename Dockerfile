FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates espeak-ng openssl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV VITE_BASE=/
RUN npm run build:root

ENV HOST=0.0.0.0
ENV PORT=8080
ENV STATIC_DIR=/app/dist
ENV DATA_DIR=/data
EXPOSE 8080
VOLUME ["/data"]
CMD ["node", "--experimental-strip-types", "server/main.ts"]
