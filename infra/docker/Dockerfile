FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci --ignore-scripts

COPY tsconfig*.json ./
COPY src ./src
COPY database ./database
COPY scripts ./scripts

RUN npm run build

FROM node:22-alpine

# python3 + make + g++ needed to compile bcrypt native addon on Linux
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force && npm install --no-save tsx

COPY --from=builder /app/dist ./dist
COPY database ./database
COPY src ./src
COPY tsconfig*.json ./

RUN addgroup -S app && adduser -S app -G app
USER app

EXPOSE 4000

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:4000/health || exit 1

CMD ["sh", "-c", "node dist/scripts/migrate.js && node dist/app/server.js"]
