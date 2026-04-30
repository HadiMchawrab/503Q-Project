FROM nginx:1.27-alpine

COPY admin-ui/nginx.conf /etc/nginx/conf.d/default.conf
COPY admin-ui/public/index.html /usr/share/nginx/html/index.html
COPY web/public/admin.js /usr/share/nginx/html/admin.js
COPY web/public/styles.css /usr/share/nginx/html/styles.css