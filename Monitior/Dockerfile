FROM node:20-alpine

WORKDIR /app

# 先装依赖，利用 Docker 层缓存
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY src ./src

# 时区设为香港，日志时间更直观
ENV TZ=Asia/Hong_Kong

CMD ["node", "src/index.js"]
