FROM node:18.17.0-bullseye-slim
COPY . /app
WORKDIR /app
RUN npm ci
CMD ["npx","ponder","start"]
