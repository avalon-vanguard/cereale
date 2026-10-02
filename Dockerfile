# Image de cereale, servie sous /cereale/ derrière la passerelle projects.avalonvanguard.com,
# qui transmet le chemin tel quel et pose les en-têtes de sécurité et la compression.
# La page docs/ est déjà construite et commitée (la CI vérifie qu'elle suit src/) : rien à
# compiler, une seule étape suffit.
FROM nginx:1.29-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docs/ /usr/share/nginx/html/cereale/
# Aperçus de liens : adresse canonique de la passerelle au lieu de github.io
RUN sed -i 's#https://avalon-vanguard.github.io/cereale/#https://projects.avalonvanguard.com/cereale/#g' /usr/share/nginx/html/cereale/index.html
