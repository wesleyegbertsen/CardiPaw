FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Release version determined by GitVersion; left empty for local builds (app then reports package.json's version).
ARG APP_VERSION=""
RUN if [ -n "$APP_VERSION" ]; then node scripts/set-version.mjs "$APP_VERSION"; fi
RUN npm run build

FROM nginx:alpine
ARG APP_VERSION=""
LABEL org.opencontainers.image.title="CardiPaw" \
      org.opencontainers.image.source="https://github.com/wesleyegbertsen/CardiPaw" \
      org.opencontainers.image.version="${APP_VERSION}"
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
