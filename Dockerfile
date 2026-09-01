# --- Стадия 1: зависимости ---
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

# --- Стадия 2: сборка ---
FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# --- Стадия 3: минимальный образ для запуска ---
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
# Только рантайм-зависимости
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 8080
CMD ["node", "dist/index.js"]