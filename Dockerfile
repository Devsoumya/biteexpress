FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Dev dependencies and tests, for `docker compose --profile test run --rm test`.
# Sits between build and runtime; the api service builds `target: runtime`.
FROM build AS test
COPY jest.config.js tsconfig.test.json zomato_data.csv ./
COPY tests ./tests
CMD ["npm", "test"]

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# Seed data for the one-shot `seed` service (2.2 MB, its own layer).
COPY zomato_data.csv ./
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
