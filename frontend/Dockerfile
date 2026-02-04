FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

# Copiamo tutto il codice
COPY . .

# --- FASE DI BUILD (La Magia) ---
# Riceviamo l'indirizzo del backend da GitHub Actions
ARG REACT_APP_API_URL
ENV REACT_APP_API_URL=$REACT_APP_API_URL

# Creiamo la versione ottimizzata per la produzione (leggerissima)
RUN npm run build

# Installiamo "serve", un server web piccolissimo e veloce
RUN npm install -g serve

# Apriamo la porta 3000
EXPOSE 3000

# Avviamo il server leggero invece di quello pesante
CMD ["serve", "-s", "build", "-l", "3000"]