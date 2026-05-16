FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package*.json ./
COPY client/package*.json ./client/
COPY server/package*.json ./server/

RUN npm ci \
  && npm --prefix client ci \
  && npm --prefix server ci

COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS web

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001

COPY server/package*.json ./server/
RUN npm --prefix server ci --omit=dev \
  && npm cache clean --force

COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/client/dist ./client/dist
COPY data/.gitkeep ./data/.gitkeep

EXPOSE 3001
CMD ["npm", "--prefix", "server", "run", "start"]
