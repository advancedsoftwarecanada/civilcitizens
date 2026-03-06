FROM node:20-alpine
WORKDIR /app
COPY package.json server.mjs ./
RUN npm install --omit=dev --no-audit --no-fund
ENV NODE_ENV=production
ENV PORT=8788
EXPOSE 8788
CMD ["node", "server.mjs"]
