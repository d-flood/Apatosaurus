FROM nginx:1.23-alpine
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY _staticfiles staticfiles