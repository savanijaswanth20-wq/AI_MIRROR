FROM node:22-alpine AS builder
WORKDIR /app
COPY frontend/package*.json frontend/
RUN cd frontend && npm ci
COPY frontend frontend
COPY shared shared
RUN cd frontend && npm run build
FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app /app
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "frontend/node_modules/next/dist/bin/next", "start", "frontend", "--hostname", "0.0.0.0"]
