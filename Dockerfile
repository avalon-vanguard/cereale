# cereale image, served under /cereale/ behind the projects.avalonvanguard.com gateway,
# which passes the path through as is and sets the security headers and compression.
# The docs/ page is already built and committed (CI checks that it follows src/): nothing to
# compile, a single stage is enough.
FROM nginx:1.31-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docs/ /usr/share/nginx/html/cereale/
# Link previews: the gateway's canonical address instead of github.io
RUN sed -i 's#https://avalon-vanguard.github.io/cereale/#https://projects.avalonvanguard.com/cereale/#g' /usr/share/nginx/html/cereale/index.html
