# ---- Build stage ----
FROM node:20-alpine AS builder
WORKDIR /app

# Install deps for building
COPY package*.json ./
RUN npm ci

# Copy source and compile to dist/
COPY tsconfig.json ./
COPY src ./src
RUN npm run build   # must produce /app/dist/index.js

# ---- Runtime stage ----
FROM node:20-alpine
WORKDIR /app

# Install only prod deps
COPY package*.json ./
RUN npm ci --omit=dev

# Bring in compiled JS only
COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/index.js"]
