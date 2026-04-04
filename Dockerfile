FROM node:20-slim

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm install typescript

# Copy source and build
COPY tsconfig.json .env.example ./
COPY src/ src/
COPY queries/ queries/
RUN npx tsc -p tsconfig.json && npm uninstall typescript

# Default: run hello-browser benchmark with 100 runs
ENV BENCHMARK=hello-browser
ENV RUNS=100
ENV PROVIDER=""
ENV CONCURRENCY=1

CMD node dist/cli.js \
  --benchmark=$BENCHMARK \
  --provider=$PROVIDER \
  --runs=$RUNS \
  --concurrency=$CONCURRENCY
