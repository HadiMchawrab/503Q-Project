FROM nginx:1.27-alpine

COPY admin-ui/nginx.conf /etc/nginx/conf.d/default.conf
COPY admin-ui/public/index.html /usr/share/nginx/html/index.html
COPY frontend/admin.js /usr/share/nginx/html/admin.js
COPY frontend/cognito.js /usr/share/nginx/html/cognito.js
COPY frontend/styles.css /usr/share/nginx/html/styles.css