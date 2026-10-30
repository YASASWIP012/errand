FROM mcr.microsoft.com/playwright:v1.64.1-noble
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ENV PORT=8787
EXPOSE 8787
CMD ["npm", "start"]
