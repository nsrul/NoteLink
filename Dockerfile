FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
ARG VITE_JAZZ_APP_ID=
ARG VITE_JAZZ_SERVER_URL=
ENV VITE_JAZZ_APP_ID=$VITE_JAZZ_APP_ID
ENV VITE_JAZZ_SERVER_URL=$VITE_JAZZ_SERVER_URL
RUN npm run build

FROM nginxinc/nginx-unprivileged:alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
