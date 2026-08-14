# Container image for running the bot on AIS Enterprise Cloud
# (or any container host / VM with Docker).
FROM node:20-alpine

WORKDIR /app

# Install production deps first for better layer caching.
COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
# The app listens on process.env.PORT (default 3000). Map/publish as needed.
EXPOSE 3000

CMD ["node", "server.js"]
