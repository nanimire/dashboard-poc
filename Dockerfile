# Stage 1: build the React app
FROM node:20-slim AS frontend-build
WORKDIR /frontend

# VITE_ vars must be present at build time; Vite bakes them into the bundle
ARG VITE_TRIGGER_TOKEN
ENV VITE_TRIGGER_TOKEN=$VITE_TRIGGER_TOKEN

COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: backend + built React static files
FROM node:20-slim
WORKDIR /app

COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY backend/ ./

# Vite outputs to /frontend/dist — copy into backend/public
COPY --from=frontend-build /frontend/dist ./public

ENV PORT=8080
EXPOSE 8080
CMD ["npm", "start"]
