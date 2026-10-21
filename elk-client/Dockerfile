FROM node:20-alpine

WORKDIR /app

COPY app/package*.json ./
RUN npm install --omit=dev

COPY app/ ./

RUN mkdir -p /app/db

EXPOSE 8070

CMD ["node", "server.js"]
