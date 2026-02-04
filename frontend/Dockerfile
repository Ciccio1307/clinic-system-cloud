FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY public/ ./public/
COPY src/ ./src/

# 🔥 FIX FONDAMENTALE:
# Dice a React di accettare connessioni da fuori (Load Balancer)
ENV HOST=0.0.0.0

# Evita che React cerchi di aprire una finestra del browser nel server (farebbe crashare tutto)
ENV CI=true 

EXPOSE 3000

CMD ["npm", "start"]