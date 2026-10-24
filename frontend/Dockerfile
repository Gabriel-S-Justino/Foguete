# Desenvolvimento: servidor Vite com proxy /api → backend. Contexto: raiz do repositório.
FROM node:22-slim
WORKDIR /srv/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY data /srv/data
COPY frontend ./
EXPOSE 5173
CMD ["npx", "vite", "--host", "0.0.0.0", "--port", "5173"]
