FROM node:18.17.0-bullseye-slim
COPY . /app
WORKDIR /app
RUN chmod +x /app/scripts/*.sh
RUN npm ci
