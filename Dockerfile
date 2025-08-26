# ---- build stage ----
FROM node:20-alpine AS builder
WORKDIR /app

# Install deps (use lockfile if present)
COPY package*.json ./
RUN npm ci

# Copy source and tsconfig, then build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build  # emits /app/dist per tsconfig

# ---- runtime stage ----
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Only production deps in final image
COPY package*.json ./
RUN npm ci --omit=dev

# Copy the compiled JS from builder
COPY --from=builder /app/dist ./dist

# (Optional) If you serve static files or need other runtime assets, copy them here
# COPY public ./public

EXPOSE 3000
CMD ["node", "dist/index.js"]
